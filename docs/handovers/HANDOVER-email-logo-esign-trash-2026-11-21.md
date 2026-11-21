# Handover: email logo + e-sign backups go to Drive trash, 20–21 Nov 2026

Slug `email-logo-esign-trash`. Tracker: `tracker/2026-11-21-email-logo-esign-trash.md`.

**Both fixes are on `dev`, not in production.** Neither was promoted in this
session. Promotion #818 (merged 21 Nov, `dfe7e877`) went out just before they
merged.

## Context

The owner forwarded the daily app-errors digest. It had an `esign-maintenance`
failure, and the Stellr logo in the email header was a broken image.

1. **Logo.** `lib/email-layout.ts` pointed at `${SITE_URL}/stellr-logo.png`,
   which has never existed (404). The file is `public/images/stellr-logo.png`.
   Every email built on the shared layout was affected: the digest, admin
   alerts and other notices. Event emails (`lib/event-emails/render.ts`, which
   uses `/email/signature-logo.png`) were fine.
2. **Server error.** The cron's `export` step keeps 30 table exports
   (`KEEP_EXPORTS` in `lib/esign/replicate.ts`) and removes older ones from the
   E-Sign Backups shared-drive folder. `backup-store.ts` called
   `files.delete`. In a shared drive only a **Manager** can delete
   permanently; the service account is a Content manager, so Drive answered
   404 "File not found" and the run failed every day.
   - #815 (promoted in #818) made that error name the missing role.
   - The first plan was to make the service account a Manager. That failed:
     Manager can only be granted on the **whole shared drive**, never on a
     folder, and the folder's share dialog silently drops it on refresh. The
     owner then gave the service account drive-wide Content manager, which
     still cannot delete.
   - The owner chose "use trash".

## What changed

| PR | Squash on `dev` | Change |
|---|---|---|
| #824 | `06c6be61` | Logo URL → `/images/stellr-logo.png`. New `lib/email-layout.test.ts` checks the `src` path and that the file exists in `public/`. |
| #825 | `e451d9da` | `driveBackupStore.remove()` moves the file to trash (`files.update`, `trashed: true`) instead of `files.delete`. A 403/404 now says the account needs Content manager on the backup folder. `find()`/`list()` already skip trashed files, so prune and retention treat a trashed copy as gone. Shared-drive trash empties itself after 30 days. `docs/RUNBOOK-backups.md` §8 and the §7 log row are rewritten to match. |

CI on both was green, every step checked (Playwright `e2e-tests` and
`e2e-local`, unit, typecheck, build).

## Not verified

- No real email has been looked at with the new logo URL. The test checks the
  path, not a mail client.
- The trash call has only run against a mocked Drive client. It runs for real
  at the first 09:22 UTC cron after #825 is promoted.
- Whether the owner removed the service account's drive-wide Content manager
  membership on "Stellr".

## Open items

See the tracker rows. In short:

- promote #825 and #824, then read the next `esign-maintenance` run;
- the owner removes the drive-wide membership;
- decide whether the Privacy Policy's "we securely delete" needs a line about
  the 30-day trash;
- an optional `/stellr-logo.png` redirect so emails already sent show the logo;
- an optional change so a failed prune does not fail the whole maintenance run.
