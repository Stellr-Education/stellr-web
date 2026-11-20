# Handover: event-email send visibility — 2026-11-18

Tracker: `tracker/2026-11-18-email-send-visibility.md` (rows `email-send-visibility.1`–`.7`).
Shipped: #799 → `dev` as `89b3f16e`; promoted in #800 (merge `6aa63946`, production `dpl_BW3noELDWA8Fb1TawfdYfNZCb7tJ`); record and sync #801 (`31a3ee56`). Migration: none.

## Context

The Minnesota Environmental Design Challenge "Outstanding consent form" email was meant to be one blast. It went out in four runs (16 Nov 4:02 PM MT, sent now; 17 Nov 8:56, 10:07 and 12:49 PM MT, scheduled), all on the code from before #776, and the History tab showed four separate rows. Three said "Cut off" and pointed at a "Resume now" button that was not there. Staff could not tell whether everyone had been emailed.

What actually happened, from Resend's send log (production DB reads stay blocked for agents):

- 39 messages to 38 addresses: 37 delivered, 1 suppressed by Resend, and 1 recipient emailed twice.
- The runs chain: 46 → 37 → 19 → 2, and the last run finished clean. The 7 who dropped between the first two runs line up with "Consent form signed" mails sent overnight. They left the "Outstanding DocuSigns" group, so were not owed the email. This was not confirmed in the DB.
- The duplicate: the 8:56 run handed 18 messages to Resend but recorded 17. It was killed after Resend accepted the 18th and before the progress write, so the 10:07 run emailed that recipient again.
- "Resume now" only shows while an email is `sending`. A scheduled run that hits its time limit puts the email back to `scheduled`, so the button never appeared for those runs.

## What changed

**History** (`components/admin/competitions/EventEmailHistory.tsx`, `lib/event-emails/send-groups.ts`):

- One row per send. An email's Sent now, Scheduled and resumed runs fold together; tests and late-registrant catch-ups stay rows of their own.
- Status: Sending / Paused part-way (gives the next cron time, plus **Open to resume** only while the email is waiting for it) / Finished / Finished — check below / Stopped.
- Counts by outcome: delivered, bounced (address on the suppression list since), not sent (suppressed), failed, unconfirmed, sending, waiting, left the group, emailed twice.
- Expanding a send lists each person ("Needs a look" first, then Everyone) with a CSV download, and the individual runs underneath.
- For runs recorded before 18 Nov, "left the group" is a count only (planned minus accounted for).

**Send path** (`lib/event-emails/send.ts`, `history.ts`, `types.ts`):

- Each address is written to the run as `sending` before it goes to Resend. A run killed mid-send leaves it `sending`; `alreadyTriedAddresses` counts it as tried, so nobody is emailed twice. History shows it as "Unconfirmed".
- A run that stops early (deadline, daily budget, tenant cron slice) lists the people it did not reach as `not_reached`. `alreadyTriedAddresses` skips those, so the next run still emails them.
- Both statuses live in the existing `event_email_sends.recipients` jsonb, so no migration.
- `EVENT_EMAIL_CRON_UTC_HOURS` (15, 17, 19) is checked against `vercel.json` by a test.

**Resend webhook** (configuration, not code):

- Created webhook `1134d623-6cff-49f3-8d0c-8b092b83c176` → `https://app.stellreducation.org/api/webhooks/resend`, for `email.bounced`, `email.complained` and `email.suppressed`.
- The owner set `RESEND_WEBHOOK_SECRET` on the `stellr-web` production project, and production was redeployed (`dpl_79KTakjc7zvFNxLwXoauW2ohwgVD`) before the promotion.
- The endpoint now answers 400 to unsigned and forged requests, where it answered 500 before.
- `email.suppressed` was already handled by `lib/email/suppressions.ts` (#776). An early claim in the session that it was not came from reading a stale local checkout.
- `stellr-web-dev` has no webhook.

## Verified

- Full unit suite: 767 files, 14,603 tests. New: `send-groups.test.ts` (including the 46 → 37 → 19 → 2 case), `EventEmailHistory.test.tsx`, and three send tests.
- #799 and #800 CI green, with `e2e-tests / Run npx playwright test` = success.
- Production after deploy: www 200, app 307 → `/sign-in`, cron guard 401, Resend webhook 400 unsigned.

## Not verified

- The History tab in production. It needs a signed-in admin, and the dev DB has no event-email sends, so it was never seen in a browser. Rendering is covered by a component test.
- No signed Resend event has arrived yet, so a bounce reaching `email_suppressions` is unproven.
- No multi-run send has happened on the new code yet.
- That the 7 (later 8) who dropped out of the consent send had all signed.

## Open items

See the tracker. The main ones:

- `.2`: look at the History tab once in production.
- `.3`: confirm the first real bounce.
- `.4`: the one Resend-suppressed recipient address from the consent send was never delivered. Names are in the Doc.
- `.6`: the owner checklist C-12 and the ENV-MATRIX row still say the webhook is not set up.
