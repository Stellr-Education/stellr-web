# Handover: hourly backup started by EventBridge (23 Nov 2026)

## Context

Better Stack opened a missed-heartbeat incident on "Stellr backup hourly" at
02:19 UTC on 23 Nov 2026. Nothing had failed: GitHub had skipped the scheduled
runs. After the workflow in the private repo `Stellr-Education/stellr-backups`
was re-enabled at 19:14 UTC on 22 Nov, only one of seven `:07` slots ran, 41
minutes late. GitHub's cron is best effort, and the hourly heartbeat allows only
30 minutes of grace. Extra cron slots were ruled out because Actions minutes are
tight (RUNBOOK-backups §2.7).

## What changed

- **Stopgap:** a manual `workflow_dispatch` (kind=hourly) at 02:29 UTC. Better
  Stack resolved the incident at 02:30 UTC.
- **AWS, project Region us-east-2** (all owner-approved, help level LOW):
  - connection `stellr-backups-github` holds the owner's fine-grained GitHub
    token (Stellr-Education, `stellr-backups` only, Actions read and write,
    366 days). Only the owner handled the token; the session never saw it.
  - API destination `stellr-backups-hourly-dispatch` POSTs to GitHub's
    `workflow_dispatch` endpoint for `backups.yml`
  - IAM role `stellr-backups-eventbridge-dispatch`
  - rule `stellr-backups-hourly`, `cron(7 * * * ? *)`, retry 3 times within 15 minutes
- **#900** (squash-merged to `dev` as `0ea60251`) removes the `7 * * * *` cron
  from `ops/backups/workflow.yml` and runs the hourly job only on
  `workflow_dispatch` with kind=hourly. It also adds RUNBOOK-backups §2.8
  (resources, token scope, where to rotate it, cost, how to check), fixes §2.5,
  §2.6, §3 and the §7 "Scheduled runs resumed" line, and adds the incident to §7.
  The owner asked the session to merge it.
- **Private repo:** `.github/workflows/backups.yml` on `stellr-backups` `main`
  now matches the merged file byte for byte (commit `1b5eeacc`).
- **Owner calendar:** a reminder to rotate the token on 10 Nov 2027.

## Verified

- EventBridge started the backup at :07:11 every hour from 03:07 to 12:07 UTC
  on 23 Nov. All 10 runs were green, heartbeat step included.
- Test dispatch 45174070744 on the new workflow file: hourly job green;
  nightly and storage skipped, as they should be.
- The copy matches: the file fetched back from `stellr-backups` diffs clean
  against `0ea60251`.

## Not verified / open

- The first hourly run *after* the copy that EventBridge starts on its own is
  13:07 UTC on 23 Nov. It is expected to work, since the trigger and the
  start condition are unchanged from the test, but it was not watched.
- There was one more `schedule` run at 08:56 UTC on 23 Nov, while GitHub's
  hourly cron still existed: a late, harmless double run. Nothing like it
  should happen after the copy.
- #900 is on `dev` only. Nothing deploys from `ops/backups/`, so it reaches
  `main` with the next ordinary promotion.
- The token's exact expiry date is shown only on GitHub's token page. 366 days
  from creation puts it around 24 Nov 2027.
- No CloudWatch alarm watches the rule's `FailedInvocations`. The Better Stack
  heartbeat already catches a missing run within 90 minutes; §2.8 says how to
  check the metric by hand.

Tracker rows: `tracker/2026-11-23-backup-hourly-eventbridge.md`.
