"""Ephemeral GitHub Actions runners on EC2, one on-demand machine per job.

Three entry points, one module (private-repo plan, 23 Nov 2026):

  webhook(event)   Lambda function URL. Checks GitHub's HMAC signature, keeps
                   only `workflow_job` / `queued` events for an allowed
                   repository whose labels include RUNNER_LABEL, and queues
                   the job id on SQS. Nothing slow happens here, so GitHub's
                   10-second webhook timeout is never at risk.
  scale(event)     SQS consumer, batch size 1. Skips a job that is no longer
                   queued, waits (by failing, so SQS retries) while MAX_VCPUS
                   machines are up, else asks GitHub for a just-in-time runner
                   config, starts one on-demand machine (the project's
                   SCPs deny spot) and hands it the config through an SSM
                   SecureString named after the instance.
  scavenge(event)  EventBridge, every 5 minutes. Terminates machines past
                   MAX_AGE_MINUTES, machines whose runner sat idle past
                   IDLE_MINUTES (its job was cancelled or taken by another
                   runner), and removes stale runner registrations and
                   leftover config parameters.

GitHub access uses a fine-grained token in SSM (GITHUB_TOKEN_PARAM): the
organisation's "Self-hosted runners: read and write" and the repository's
"Actions: read". Standard library plus boto3 only.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import boto3

ORG = os.environ["GITHUB_ORG"]
REPOS = {r.strip() for r in os.environ["ALLOWED_REPOS"].split(",") if r.strip()}
LABEL = os.environ["RUNNER_LABEL"]
SMALL_LABEL = os.environ.get("SMALL_RUNNER_LABEL", "")
RUNNER_GROUP_ID = int(os.environ.get("RUNNER_GROUP_ID", "1"))
MAX_VCPUS = int(os.environ["MAX_VCPUS"])
MAX_AGE_MINUTES = int(os.environ["MAX_AGE_MINUTES"])
IDLE_MINUTES = int(os.environ["IDLE_MINUTES"])
QUEUE_URL = os.environ.get("QUEUE_URL", "")
LAUNCH_TEMPLATE_ID = os.environ.get("LAUNCH_TEMPLATE_ID", "")
INSTANCE_TYPES = [t.strip() for t in os.environ.get("INSTANCE_TYPES", "").split(",") if t.strip()]
SMALL_INSTANCE_TYPES = [t.strip() for t in os.environ.get("SMALL_INSTANCE_TYPES", "").split(",") if t.strip()]
# vCPUs per size: the on-demand quota is counted in vCPUs.
VCPUS = {"large": 4, "small": 2}
SUBNET_IDS = [s.strip() for s in os.environ.get("SUBNET_IDS", "").split(",") if s.strip()]
TOKEN_PARAM = os.environ["GITHUB_TOKEN_PARAM"]
SECRET_PARAM = os.environ["WEBHOOK_SECRET_PARAM"]
JIT_PREFIX = os.environ["JIT_PARAM_PREFIX"].rstrip("/")
TAG_KEY = "stellr-ci-runner"
NAME_PREFIX = "stellr-ci-"

ec2 = boto3.client("ec2")
ssm = boto3.client("ssm")
sqs = boto3.client("sqs")

_params: dict = {}


def _param(name: str) -> str:
    if name not in _params:
        _params[name] = ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    return _params[name]


def _log(msg: str, **fields) -> None:
    print(json.dumps({"msg": msg, **fields}))


def _github(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {_param(TOKEN_PARAM)}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "stellr-ci-runners",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def _resp(status: int, text: str) -> dict:
    return {"statusCode": status, "headers": {"content-type": "text/plain"}, "body": text}


# --- webhook -----------------------------------------------------------------

def webhook(event, _context):
    body = event.get("body") or ""
    raw = base64.b64decode(body) if event.get("isBase64Encoded") else body.encode()
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    expected = "sha256=" + hmac.new(_param(SECRET_PARAM).encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(headers.get("x-hub-signature-256", ""), expected):
        return _resp(401, "bad signature")
    kind = headers.get("x-github-event", "")
    if kind == "ping":
        return _resp(200, "pong")
    if kind != "workflow_job":
        return _resp(202, "ignored: event")
    payload = json.loads(raw)
    job = payload.get("workflow_job") or {}
    repo = (payload.get("repository") or {}).get("full_name", "")
    labels = set(job.get("labels") or [])
    if payload.get("action") != "queued":
        return _resp(202, "ignored: action")
    if repo not in REPOS:
        return _resp(202, "ignored: repository")
    if "self-hosted" not in labels:
        return _resp(202, "ignored: labels")
    if LABEL in labels:
        size = "large"
    elif SMALL_LABEL and SMALL_LABEL in labels:
        size = "small"
    else:
        return _resp(202, "ignored: labels")
    sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps({"repo": repo, "job_id": job["id"], "size": size}))
    _log("queued", repo=repo, job_id=job["id"], job=job.get("name"))
    return _resp(202, "queued")


# --- scale -------------------------------------------------------------------

def _live_instances() -> list:
    out = []
    for page in ec2.get_paginator("describe_instances").paginate(
        Filters=[
            {"Name": f"tag:{TAG_KEY}", "Values": ["1"]},
            {"Name": "instance-state-name", "Values": ["pending", "running"]},
        ]
    ):
        for r in page["Reservations"]:
            out.extend(r["Instances"])
    return out


def _launch(size: str) -> str | None:
    """One on-demand machine, trying each instance type in each subnet.

    On-demand only: the AWS project's managed SCPs deny spot instances
    (DenySpotMarketType, DenyRequestSpotInstances) and EC2 Fleet
    (DenyEC2Fleet) on every plan, and cannot be changed without activating
    advanced features (23 Nov 2026).
    """
    tags = [
        {"ResourceType": "instance", "Tags": [{"Key": TAG_KEY, "Value": "1"}, {"Key": "Name", "Value": "stellr-ci-runner"}, {"Key": "runner-size", "Value": size}]},
        {"ResourceType": "volume", "Tags": [{"Key": TAG_KEY, "Value": "1"}]},
    ]
    errors = []
    for instance_type in (SMALL_INSTANCE_TYPES if size == "small" else INSTANCE_TYPES):
        for subnet in SUBNET_IDS:
            try:
                result = ec2.run_instances(
                    LaunchTemplate={"LaunchTemplateId": LAUNCH_TEMPLATE_ID, "Version": "$Latest"},
                    InstanceType=instance_type,
                    SubnetId=subnet,
                    MinCount=1,
                    MaxCount=1,
                    TagSpecifications=tags,
                )
                return result["Instances"][0]["InstanceId"]
            except ec2.exceptions.ClientError as e:
                code = e.response.get("Error", {}).get("Code", "")
                errors.append(f"{instance_type}/{subnet}: {code}")
                # Capacity is per type and zone: try the next. Anything else
                # (permissions, quota, a bad template) will not improve.
                if code not in ("InsufficientInstanceCapacity", "Unsupported", "InstanceLimitExceeded"):
                    _log("launch failed", errors=errors)
                    return None
    _log("no capacity", errors=errors[:12])
    return None


def scale(event, _context):
    for record in event["Records"]:
        msg = json.loads(record["body"])
        repo, job_id = msg["repo"], msg["job_id"]
        size = msg.get("size", "large")
        try:
            status = _github("GET", f"/repos/{repo}/actions/jobs/{job_id}").get("status")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                _log("job gone", job_id=job_id)
                continue
            raise
        if status != "queued":
            _log("job no longer queued", job_id=job_id, status=status)
            continue
        used = sum(
            VCPUS.get({t["Key"]: t["Value"] for t in i.get("Tags", [])}.get("runner-size", "large"), 4)
            for i in _live_instances()
        )
        if used + VCPUS[size] > MAX_VCPUS:
            # Raising returns the message to the queue; SQS retries it after
            # the visibility timeout, until a machine frees up.
            raise RuntimeError(f"at capacity ({used}/{MAX_VCPUS} vCPU); job {job_id} waits")
        name = f"{NAME_PREFIX}{job_id}-{int(time.time())}"
        jit = _github(
            "POST",
            f"/orgs/{ORG}/actions/runners/generate-jitconfig",
            {"name": name, "runner_group_id": RUNNER_GROUP_ID, "labels": ["self-hosted", "linux", "x64", LABEL if size == "large" else SMALL_LABEL], "work_folder": "_work"},
        )
        instance_id = _launch(size)
        if not instance_id:
            try:
                _github("DELETE", f"/orgs/{ORG}/actions/runners/{jit['runner']['id']}")
            except urllib.error.HTTPError:
                pass
            raise RuntimeError(f"no capacity for job {job_id}; retrying")
        try:
            # A just-in-time config is longer than the standard tier's 4 KB.
            # Intelligent-Tiering picks advanced only when needed; each lives
            # for minutes, so the advanced-tier charge is a fraction of a cent.
            ssm.put_parameter(
                Name=f"{JIT_PREFIX}/{instance_id}",
                Value=jit["encoded_jit_config"],
                Type="SecureString",
                Tier="Intelligent-Tiering",
                Overwrite=True,
            )
        except Exception:
            # The machine would wait for a config that never comes: stop it now.
            ec2.terminate_instances(InstanceIds=[instance_id])
            raise
        ec2.create_tags(Resources=[instance_id], Tags=[{"Key": "runner-name", "Value": name}, {"Key": "job-id", "Value": str(job_id)}])
        _log("started", job_id=job_id, instance_id=instance_id, runner=name)


# --- scavenge ----------------------------------------------------------------

def _minutes_since(when) -> float:
    if isinstance(when, str):
        when = datetime.fromisoformat(when.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - when).total_seconds() / 60


def scavenge(_event, _context):
    runners = []
    page = 1
    while True:
        batch = _github("GET", f"/orgs/{ORG}/actions/runners?per_page=100&page={page}")["runners"]
        runners.extend(r for r in batch if r["name"].startswith(NAME_PREFIX))
        if len(batch) < 100:
            break
        page += 1
    by_name = {r["name"]: r for r in runners}

    live = _live_instances()
    live_ids = {i["InstanceId"] for i in live}
    live_names = set()
    doomed = []
    for inst in live:
        tags = {t["Key"]: t["Value"] for t in inst.get("Tags", [])}
        name = tags.get("runner-name", "")
        live_names.add(name)
        age = _minutes_since(inst["LaunchTime"])
        runner = by_name.get(name)
        if age > MAX_AGE_MINUTES:
            doomed.append((inst["InstanceId"], "max age", runner))
        elif age > IDLE_MINUTES and runner is not None and not runner["busy"]:
            doomed.append((inst["InstanceId"], "idle", runner))
        elif age > IDLE_MINUTES and runner is None:
            doomed.append((inst["InstanceId"], "never registered", None))
    if doomed:
        ec2.terminate_instances(InstanceIds=[d[0] for d in doomed])
    for instance_id, why, runner in doomed:
        _log("terminated", instance_id=instance_id, reason=why)
        if runner is not None:
            try:
                _github("DELETE", f"/orgs/{ORG}/actions/runners/{runner['id']}")
            except urllib.error.HTTPError:
                pass

    for r in runners:
        if r["name"] not in live_names and r["status"] == "offline":
            try:
                _github("DELETE", f"/orgs/{ORG}/actions/runners/{r['id']}")
                _log("removed stale runner", runner=r["name"])
            except urllib.error.HTTPError:
                pass

    for page in ssm.get_paginator("get_parameters_by_path").paginate(Path=JIT_PREFIX):
        for p in page["Parameters"]:
            instance_id = p["Name"].rsplit("/", 1)[-1]
            if instance_id not in live_ids:
                ssm.delete_parameter(Name=p["Name"])
                _log("removed leftover config", instance_id=instance_id)
