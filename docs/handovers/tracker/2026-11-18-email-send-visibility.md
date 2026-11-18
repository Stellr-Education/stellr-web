# Event-email send visibility — 2026-11-18

Slug: `email-send-visibility`. Handover: `HANDOVER-email-send-visibility-2026-11-18.md`. Doc snapshot: `1md8CQlj2gaopMewJbtYMI0tJLTV2WJipcyvwW6xBXYk`.
PR #799 → `dev` as `89b3f16e`; promoted in #800 (`6aa63946`). Migration: none.

The event-email History shows an email's runs as one send, with a status, counts by outcome and a per-person list. A run killed mid-send can no longer email someone twice. The Resend delivery webhook is live on production.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| email-send-visibility.1 | History groups runs into one send; no duplicates from a killed run | Live in production (`dpl_BW3noELDWA8Fb1TawfdYfNZCb7tJ`). Unit suite 14,603 pass; #800 CI green with e2e run | — | ☑ |
| email-send-visibility.2 | History tab seen in production | Not opened signed-in; the dev DB has no sends, so no browser check was possible. Rendering is covered by `EventEmailHistory.test.tsx` | Open any event's Email Engagement tab on production and expand the consent send | ☐ |
| email-send-visibility.3 | First real Resend event reaches the app | Webhook `1134d623-…` created; secret set on production; endpoint answers 400 unsigned/forged. No signed event seen yet | After the next bounce, check Resend → Webhooks shows a 200 and the address is in `email_suppressions` (owner runs the prod read) | ☐ |
| email-send-visibility.4 | Consent-send recipient whose address Resend suppressed | One recipient address on the MN consent send was suppressed by Resend (16–17 Nov) and never received the email. Names in the Doc, row `.4` | Check whether it is a participant or a guardian, fix the address on their member record, then send the form again or use the late-registrant catch-up | ☐ |
| email-send-visibility.5 | Recipient emailed twice | The 17 Nov 8:56 MT run was killed after Resend accepted, and the 10:07 run re-sent. Cause fixed by `.1`. Names in the Doc, row `.5` | None needed; an apology only if the family raises it | ☑ |
| email-send-visibility.6 | Docs still say the webhook is not set up | `docs/OWNER-CHECKLIST-S1-S4.md` C-12 and the `docs/ENV-MATRIX.md` `RESEND_WEBHOOK_SECRET` row describe it as missing; production now has it (dev does not) | Update both to "production done 18 Nov; `stellr-web-dev` webhook still optional" | ☐ |
| email-send-visibility.7 | Tell the sender when a multi-run send finishes | Not built; declined for this pass. History's status covers it in the tab | Decide whether a toast or an email to the sender is wanted | ☐ |

## Closes

- `email-send-receipts.4` (MN consent send finishes): Resend's log shows the last run at 17 Nov 19:49 UTC sent the final 2. The run chain 46 → 37 → 19 → 2 closes with nobody left, and the email is `sent` (History groups it as Finished).
- `email-send-receipts.6` (Resend webhooks): the webhook was created 18 Nov for `email.bounced`, `email.complained` and `email.suppressed`, and `RESEND_WEBHOOK_SECRET` was set on production and redeployed. `/api/webhooks/resend` answers 400 to unsigned and forged requests, no longer 500. The first signed event is tracked as `email-send-visibility.3`.
- `esign-prod-switch-on.4` (bounce tracking for Stellr signing emails): the same webhook, including `email.bounced`, now reaches `lib/esign/bounces.ts` on production. The first real event is tracked as `email-send-visibility.3`.
