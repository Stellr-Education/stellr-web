# Hourly backup started by EventBridge — 2026-11-23

Slug: `backup-hourly-eventbridge`. Handover: `HANDOVER-backup-hourly-eventbridge-2026-11-23.md`. Doc snapshot: `1MnN75bxia-9Z5sYU_VFvCyc2fJO_sSgHNo2n0rD4C08`.
PR #900 → `dev` as `0ea60251`; not promoted (ops/docs only, nothing deploys). Migration: none.

GitHub kept skipping the hourly backup's cron, so an AWS EventBridge rule (us-east-2) now starts the hourly run at :07 UTC through `workflow_dispatch`. GitHub's hourly cron is removed in both stellr-web and `stellr-backups`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| backup-hourly-eventbridge.1 | EventBridge trigger live | Rule `stellr-backups-hourly` ENABLED; 10 runs started by EventBridge, 03:07–12:07 UTC on 23 Nov, all green | — | ☑ |
| backup-hourly-eventbridge.2 | Workflow copied to `stellr-backups` | `main` at `1b5eeacc` diffs clean against stellr-web `0ea60251`; test dispatch 45174070744 green | — | ☑ |
| backup-hourly-eventbridge.3 | First EventBridge run after the copy | Due 13:07 UTC on 23 Nov; not watched | `gh run list -R Stellr-Education/stellr-backups --limit 3`: expect `workflow_dispatch` success at :07, and no `schedule` runs at :07 | ☐ |
| backup-hourly-eventbridge.4 | #900 reaches `main` | On `dev` only | Rides the next promotion; nothing to do separately | ☐ |
| backup-hourly-eventbridge.5 | Rotate the GitHub token before it expires (~24 Nov 2027) | Owner calendar reminder on 10 Nov 2027 | Follow RUNBOOK-backups §2.8 | ☐ |

## Closes

- The stack-review handover's "Scheduled runs resumed" note for backups (RUNBOOK-backups §7, 22 Nov) was wrong. #900 corrects it in §7 and records the 23 Nov incident there.
