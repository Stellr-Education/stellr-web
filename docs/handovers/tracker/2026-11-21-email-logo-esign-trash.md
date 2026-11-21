# Email logo + e-sign backups to Drive trash — 2026-11-21

Slug: `email-logo-esign-trash`. Handover: `HANDOVER-email-logo-esign-trash-2026-11-21.md`. Doc snapshot: `1L7YOTgvpeqc4oRsl2IgFO2CK_kC3uiKRU2u9jzOYEdA`.
#824 → `dev` as `06c6be61`; #825 → `dev` as `e451d9da`; neither promoted. Migration: none.

The email layout's logo points at the real file (`/images/stellr-logo.png`), and the e-sign backup clean-up moves Drive files to trash instead of deleting them, so the service account's Content manager role is enough.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| email-logo-esign-trash.1 | Promote #824 + #825 | Both squash-merged into `dev` 21 Nov after #818 landed; CI green on both, every step checked | Next promotion | ☐ |
| email-logo-esign-trash.2 | `esign-maintenance` alert stops | Fails daily on prod (Drive 404 on permanent delete) until .1 | After .1: the next 09:22 UTC `cron_runs` row for `esign-maintenance` succeeds, and the E-Sign Backups folder holds 30 exports (45+ before) | ☐ |
| email-logo-esign-trash.3 | Logo shows in a real email | Unit test checks path + file only; no mail client checked | After .1: open the next app-errors digest or admin alert | ☐ |
| email-logo-esign-trash.4 | Remove the service account's drive-wide membership | Owner gave it Content manager on the whole "Stellr" shared drive 20 Nov; only the E-Sign Backups folder share is needed. Not confirmed removed | Owner, after .2 passes: Stellr → Manage members → remove the service account | ☐ |
| email-logo-esign-trash.5 | Privacy Policy and the 30-day trash | `app/(stellr)/(public)/privacy/page.tsx` says "we securely delete" with no deadline; removed copies (encrypted) now sit in Drive trash up to 30 days. Unchanged | Owner decides whether to add a line; otherwise close | ☐ |
| email-logo-esign-trash.6 | Old emails still show a broken logo | Mail already sent points at `/stellr-logo.png` (404). Offered a redirect; not requested | Optional: add a permanent redirect `/stellr-logo.png` → `/images/stellr-logo.png` in `next.config` | ☐ |
| email-logo-esign-trash.7 | A failed prune fails the whole maintenance run | Recommended making prune failures non-fatal (reported separately); not built | Optional follow-up in `lib/esign/maintenance.ts` | ☐ |
