# E-sign Drive backups + promotion #818 — 2026-11-21

Slug: `esign-backup-drive`. Handover: `HANDOVER-esign-backup-drive-2026-11-21.md`. Doc snapshot: `15RUppk9hb1fvArDQPFGsdVVbTwAjXbNz3RPsDaKRu2k`.
PR #815 → `dev` as `bcc2e11d`; promoted in #818 (`dfe7e877`). Migration in the promotion: `20261120185125_tenant_host_map_public` (#820's), applied by Action run 44841248702.

E-sign Drive copies stay encrypted; the restore drill finds hash-named copies and decrypts exports; promotion #818 is live as `dpl_9tUB9WvyBx9xSGKDoeVe1bpvu2ZG`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| esign-backup-drive.1 | Drive pruning: exports pile up (45 vs keep 30) because the service account cannot permanently delete | #825 (trash instead of delete) merged into dev 21 Nov, not promoted. The earlier owner action (grant Manager on the shared drive) is superseded | Promote #825; the next nightly run should leave 30 exports in the folder (trashed ones excluded) | ☐ |
| esign-backup-drive.2 | Real decrypt of a Drive copy with the owner's key | Commands in `docs/RUNBOOK-backups.md` §8; tested only with test keys in unit tests | Owner runs `scripts/esign-restore-drill.ts --export latest --out <dir>` with the key from the password manager, once | ☐ |
| esign-backup-drive.3 | Outbox drains per tenant on production (#764) | Live since 21 Nov 16:50 UTC; no drain observed yet | Read the 18:05 UTC `/api/cron/email-outbox` log on 21 Nov; Stellr rows sent, no errors | ☐ |
| esign-backup-drive.4 | Stellr staff on event admin in production after the authz moves (#767, #808, #819, #829, #830) | e2e green in CI; not hand-checked on production; no level:error logs in the first 10 minutes | A Stellr admin opens one event's check-in desk, awards and scholarships pages | ☐ |
| esign-backup-drive.5 | Promotion record and sync | #834 merged into dev as `e7a5a3a1`; `dfe7e877` is an ancestor of dev | — | ☑ |
