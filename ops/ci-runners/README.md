# CI runners on AWS

Ephemeral GitHub Actions runners for `Stellr-Education/stellr-web`: one EC2
on-demand machine per job, terminated when the job ends. Part of the private-repo
plan (23 Nov 2026). Private repositories pay for GitHub-hosted minutes, and the
org's Actions budget is $10 a month with a hard stop. Self-hosted minutes are
free on GitHub, and the machines are paid from the TechSoup AWS credit.

Region: **us-east-2** (the AWS project's selected Region).

## How it works

```
GitHub org webhook (workflow_job)
  → Lambda function URL `webhook`   checks the HMAC, keeps queued jobs for
                                    stellr-web labelled `stellr-ci`
  → SQS queue                       retries every 60 s while all machines are busy
  → Lambda `scale` (one at a time)  checks the job is still queued, gets a
                                    just-in-time runner config, starts a machine
                                    (on-demand), hands it the
                                    config through SSM /stellr/ci-runners/jit/<instance-id>
  → EC2 machine                     reads and deletes its config, runs one job,
                                    shuts down (shutdown behaviour: terminate)
Lambda `scavenge` (every 5 min)     terminates machines older than 400 min or
                                    idle for 20 min, removes stale runners and
                                    leftover configs
```

- Machines: 4 vCPU / 16 GiB (m7i, m6i, m7i-flex, m6a, m7a, m5 `.xlarge`, any
  Availability Zone), 100 GB encrypted gp3, IMDSv2 required, no inbound ports.
  Debug with Session Manager, not SSH.
- Two sizes: label `stellr-ci` gets 4 vCPU / 16 GiB (jobs that build the app),
  `stellr-ci-small` gets 2 vCPU / 8 GiB (unit tests, database, security scans).
  At most 16 vCPU at once (`MaxVcpus`), the account's on-demand quota. Spot and EC2 Fleet are denied by the project's managed SCPs on every
  plan (23 Nov 2026); lifting that means activating advanced features, which is
  irreversible and removes the spend limit.
- Machines hold the same secrets CI's jobs already receive (dev Supabase and
  Clerk test keys). **Production stays on GitHub-hosted runners**: the
  `Production migration` Action never uses the `stellr-ci` label.
- Only safe while the repository is **private**. On a public repository, anyone
  could open a PR that runs code on these machines.

## Files

| File | What it does |
|---|---|
| `template.yml` | The CloudFormation stack `stellr-ci-runners` |
| `lambda/runners.py` | The webhook, scale and scavenge functions |
| `bake-userdata.sh` | Builds the runner image on a fresh Ubuntu 24.04 machine |
| `bake-ami.sh` | Runs the bake and stores the image ID in `/stellr/ci-runners/ami-id` |
| `deploy.sh` | Uploads the Lambda code and deploys the stack |

## Set up (once)

1. **Image**: `AWS_PROFILE=stellr bash ops/ci-runners/bake-ami.sh` (about 25-40
   minutes). Re-bake monthly, or when Playwright's major version changes.
2. **GitHub token**: the owner creates a fine-grained personal access token.
   - Resource owner: Stellr-Education. Repository access: only stellr-web.
   - Permissions: Organization **Self-hosted runners: Read and write**;
     Repository **Actions: Read**.
   - Expiry: 1 year, with a calendar reminder to rotate it.
   - The owner stores it (it never passes through Claude):
     `aws ssm put-parameter --profile stellr --region us-east-2 --name /stellr/ci-runners/github-token --type SecureString --value '<token>'`
3. **Webhook secret**: a random value in `/stellr/ci-runners/webhook-secret`
   (SecureString).
4. **Stack**: `AWS_PROFILE=stellr bash ops/ci-runners/deploy.sh [budget-email]`.
   It prints the webhook URL. With an email, it also creates a $60-a-month AWS
   budget that alerts at 80% actual and 100% forecast.
5. **Org webhook**: Stellr-Education → Settings → Webhooks.
   - Payload URL: the printed URL. Content type: `application/json`.
   - Secret: the value from step 3.
   - Events: **Workflow jobs** only.
6. **Runner group** (recommended): a group visible only to stellr-web. Set
   `RunnerGroupId` to its ID and redeploy.
7. **Move jobs**: `runs-on: [self-hosted, stellr-ci]` on the heavy jobs. Keep
   the `Production migration` workflow on `ubuntu-latest`.

## Operating

- Logs: CloudWatch `/aws/lambda/stellr-ci-runners-*` (14 days). Each machine's
  boot log is `/var/log/stellr-runner.log`.
- A job stuck in "Waiting for a runner": check the `scale` logs, then the dead-letter
  queue (it holds jobs that waited about 6 hours).
- To stop everything: set `MaxVcpus` to 0 and redeploy, or disable the
  webhook. Jobs then wait; nothing runs on GitHub's paid minutes unless a
  workflow is moved back to `ubuntu-latest`.
- Cost (24 Nov model, after the CI trims, with two sizes): about $88 a month,
  or about $58-71 a month once PRs are opened as drafts and marked ready once.
  The TechSoup credit covers $1,000 a year. The gate and scope jobs stay on
  GitHub-hosted runners (about $15 a month, inside the plan's included $18).
