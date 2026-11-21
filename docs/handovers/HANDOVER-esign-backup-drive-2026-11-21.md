# Handover: e-sign Drive backups + promotion #818 (20–21 Nov 2026)

Slug: `esign-backup-drive`. Tracker: `tracker/2026-11-21-esign-backup-drive.md`.

## Context

The owner reviewed the "E-Sign Backups" shared-drive folder expecting plain PDF copies of executed agreements and found `.enc` files. Decision (20 Nov): **keep the copies encrypted** (AES-256-GCM, `ESIGN_BACKUP_KEY`, "SEB1" format); the Privacy Policy promises Google cannot read them.

## What changed

- **#815** (squash `bcc2e11d`, PROMOTED 21 Nov via #818 `dfe7e877`):
  - `lib/esign/replicate.ts` `findSignedCopy`: the restore drill now finds hash-named signed copies (`<id>-signed-<sha16>.pdf.enc`) as well as legacy names; before, `--restore` missed 40 of 68.
  - `scripts/esign-restore-drill.ts --export latest|<name> --out`: decrypts a table export without the database.
  - `lib/esign/backup-store.ts` `remove`: a Drive delete refusal now names the role problem.
  - `docs/RUNBOOK-backups.md` §8: how to open the Drive copies (use the app first; key from the password manager; commands; handling).
- **Root cause found:** production calls Drive as the backup service account, which is **Content manager** on the shared drive; Drive answers `files.delete` from a non-Manager with 404 "File not found". So exports were never pruned (45 vs 30), and retention removals would fail the same way. Verified with a probe file (create, delete refused 404, trashed instead).
- **#825** (another session, merged into dev 21 Nov 17:12 UTC, NOT promoted): `remove` now trashes instead of deleting, so Content manager is enough. This **supersedes** the owner action this session left (grant Manager on the shared drive).
- **Promotion #818** (dev → main) merged 21 Nov 16:50 UTC as `dfe7e877` from dev `ae5f119e`; live as `dpl_9tUB9WvyBx9xSGKDoeVe1bpvu2ZG`. Carried S5 wave 8/9 (#764 outbox per tenant, #810 Lane C writers, #812, #808, #766, #804, #767, #819–#823, #759, #826–#831) plus #815. Record and sync: #834 (`e7a5a3a1`). Full record: `.claude/releases/promote-2026-11-20c.md`.
  - Migration `20261120185125_tenant_host_map_public` (#820) went through the Production migration Action. First run (44838388284) rolled back: `security_checks.sql` had no WD-1 anon exception while its pgTAP twin did. #826 fixed it; second run (44841248702) applied it, ledger row verified, security checks clean.
  - The owner's yes was refused by GitHub twice because the S5 session kept merging into dev; it paused on request for the final merge.

## Not verified

- A real decrypt of a Drive copy with the owner's key.
- The per-tenant outbox drain (#764) on production: first run on the new code is the 18:05 UTC cron on 21 Nov.
- Stellr staff on event admin pages in production (check-in desk, awards, credentials, scholarships, event managers): e2e in CI only.
- `db:status --prod` (agents have no production DB reads); the Action verified the one migration.

## Open items

See the tracker file: `esign-backup-drive.1`–`.5`.
