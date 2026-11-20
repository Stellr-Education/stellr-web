# Handover — event email sends + payment documents (17 Nov 2026)

Tracker: `tracker/2026-11-17-email-send-receipts.md` (rows `email-send-receipts.1`–`.13`).

**First: nothing from this session is merged or promoted.** #776 and #777 are green
and open against `dev`; auto mode refused the merge, and the owner promotes in a
separate session.

## What was asked

1. Why did an Email Engagement "Send now" on the MN event fail ("Send failed."), and stop it happening again.
2. Payers need an invoice and a receipt from their account; admins, staff and event managers need to download them on someone's behalf. Prompted by a teacher who paid by pay link (who: in the Doc).
3. What the two "Incomplete" History rows on that email mean, its current state, and how to prevent it.

Then: "proceed with all recommendations".

## Findings (evidence: Resend send log, Stripe, code; prod DB not read; Vercel Hobby logs had expired)

- **1 and 3 are one fault.** `POST …/emails/[id]/send` runs in a 60s function. Before any email went out it re-sent each outstanding DocuSign envelope one at a time (`resend_docusign`). On 16 Nov 23:02 UTC Resend shows 2 emails, then nothing: the function was killed. The browser got no JSON, so the editor showed its fallback "Send failed."; the email stayed `sending`; the run had no `finished_at` → "Incomplete".
- The cron's `reclaimStuckSending` resumed it 17 Nov ~15:56 UTC, re-sent DocuSign again, sent 18, was killed again (second "Incomplete"). At 17:07 it resumed again and sent 17 more. One guardian got it twice: the 15:56 run was killed between sending to them and writing its progress.
- One recipient showed as sent in History but Resend had suppressed the address. `deliver` ignored `sendEmail`'s `{suppressed}` / `{queued}` results.
- The Resend API lists **no webhooks**, so our suppression list probably never hears about bounces (row `.6`).
- The teacher's Stripe charge has a `receipt_url`, `receipt_email: null`, and no invoice: Checkout never had `invoice_creation`, and only Stellr admins could see member documents (via view-as).

## What changed

### #776 `fix/event-email-send-resume` (2 commits)
- `sendEventEmail` / `deliver` take a **deadline** (route and cron: 50s from start) and stop between recipients before it, recording finished counts; the email stays `sending` and the outcome says `stoppedFor: 'time'`, `remaining`.
- `POST …/send { continue: true }` carries it on; the editor loops on it, and a **Resume now** button shows on any `sending` email.
- Live runs **heartbeat** `event_emails.updated_at`; `SENDING_STALE_MS` 10 min → 2 min, `CONTINUE_STALE_MS` 20s; a continue also takes over at once when the latest run recorded `finished_at` (CAS on `updated_at`).
- DocuSign re-send only on an email's **first** run, 4 at a time, capped 15s.
- A resumed send with nobody left is marked sent (was refused → stuck).
- Recipients record `suppressed` / `queued` and Resend's id; History shows "Sending… X of Y", "Cut off — X of Y reached", "carried on in the next run", "not delivered (address blocked)"; the list API flags addresses now on the suppression list; a 502/504 explains itself.
- Resend webhook records `email.suppressed`.

### #777 `feat/payment-documents` (3 commits)
- Every event Checkout sets `invoice_creation` (metadata `source: 'checkout'`, `checkoutRegistrationId`, `checkoutParticipantId`; never `registrationId`) and `payment_intent_data.receipt_email` when the payer's address is known. `invoice.paid` skips Checkout invoices (test proves no group-ledger write). Switch: `CHECKOUT_INVOICES_ENABLED`.
- `lib/payments/documents.ts` resolves a place's documents; `lib/payments/paid-invoice-pdf.ts` renders our own paid invoice (pdf-lib; `ORG_POSTAL_ADDRESS`).
- Routes: `/api/members/billing/paid-invoice?participation=`; crew `/api/admin/registrations/[id]/receipt?participant=` and `/paid-invoice?participant=` (`requireEventCrew`, Stellr-only, audited).
- UI: Billing tab Documents column, roster links on paid rows, admin member **Payments** panel.

## Not verified

- No browser check of either PR; #777 not exercised against live Stripe (rows `.9`, `.10`).
- The DocuSign cause is inferred from timing (no logs survived); the deadline handles any slow prelude regardless.

## Session gaps (honest)

- I pushed the receipts branch before my PII check finished: three test fixtures used the teacher's first name and last initial. Renamed, re-pushed as `feat/payment-documents`, old remote branch deleted; no PR referenced it, but the commits may stay reachable by SHA for a while.
- The receipts subagent reported "typecheck passes" while `components/admin/MemberPaymentsPanel.tsx` was empty; CI caught it (#777 red), fixed in `67e465b7`. All gates were then re-run locally.
- The receipt was not sent to the teacher (an outward message; left to the owner, row `.5`).
