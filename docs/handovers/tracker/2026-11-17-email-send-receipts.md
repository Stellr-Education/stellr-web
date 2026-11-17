# Event email sends + payment documents — 2026-11-17

Slug: `email-send-receipts`. Handover: `HANDOVER-email-send-receipts-2026-11-17.md`. Doc snapshot: `17VgZDyWH4Ag3WVwx8f-skW2O-B7Eu9Us-yX10QKDkWE`.
PRs #776 (event email sends) and #777 (invoices and receipts) → `dev`: both green, **NOT merged** (auto mode blocks merging; the owner merges). Not promoted (promotion runs in a separate session). Migration: none.

Diagnosed why an MN "Send now" failed and left two "Incomplete" History rows (the 60s function limit, most likely spent on DocuSign re-sends), and built: time-limited sends that continue, DocuSign once, honest History (#776); Stripe paid invoices + receipt emails for new card payments, our own paid-invoice PDF, and Receipt/Invoice downloads for payers and crew (#777).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| email-send-receipts.1 | Merge #776 into `dev` | All required checks pass (step outcomes read). Auto mode refused the merge. | Owner: `gh pr merge 776 --squash --delete-branch` from the main checkout | ☐ |
| email-send-receipts.2 | Merge #777 into `dev` | All required checks pass after the fix in `67e465b7` (empty `MemberPaymentsPanel.tsx`). | Owner: `gh pr merge 777 --squash --delete-branch` from the main checkout | ☐ |
| email-send-receipts.3 | Promote #776 + #777 | Not on `main`. Owner runs promotion in a separate session. | `promote` after .1 and .2 | ☐ |
| email-send-receipts.4 | MN "Outstanding consent form" send finishes | Production, old code. Resend log: 2 sent 16 Nov 23:02 UTC; 18 more 17 Nov 15:56; 17 more 17:07 (alphabetical, through the V surnames). Each run likely killed at 60s again, so the email is probably still `sending` with a few left. One guardian got it twice (run killed between the send and its progress write). | Check the History tab after the 19:00 UTC run; press nothing until #776 is live (then "Resume now" if still sending) | ☐ |
| email-send-receipts.5 | Teacher's receipt and invoice (9 Nov $82.45 pay-link payment) | Stripe charge has a hosted receipt; no invoice; Stripe never emailed the receipt. Nothing sent to her. Who: in the Doc. | Owner: Stripe → Payments → that charge → Send receipt; or the Invoice link once #777 is live | ☐ |
| email-send-receipts.6 | Resend webhooks | Resend API lists **0 webhooks**, so bounce/complaint/suppressed events likely never reach `/api/webhooks/resend` (the suppression list only fills from them). | Owner: Resend → Webhooks → add `email.bounced`, `email.complained`, `email.suppressed` → `/api/webhooks/resend`; check `RESEND_WEBHOOK_SECRET` | ☐ |
| email-send-receipts.7 | Stripe post-payment invoice fee | `CHECKOUT_INVOICES_ENABLED = true` in `lib/payments/checkout-invoice.ts`; Stripe charges per invoice Checkout creates. | Owner decides; set `false` to stop (receipts + our PDF still work) | ☐ |
| email-send-receipts.8 | Stripe "Successful payments" customer email | Not checked. Pay-link payers type their own address, so whether they get receipt/invoice emails depends on this dashboard setting. | Owner: Stripe → Settings → Customer emails | ☐ |
| email-send-receipts.9 | Browser check of both PRs | Not done: no feature-branch previews; no local signed-in admin run. Unit + Playwright CI only. | After promotion: one MN-sized send on dev (watch it continue), and download a Receipt/Invoice from the roster, member page and Billing tab | ☐ |
| email-send-receipts.10 | #777 against live Stripe | Not exercised. Stripe search can take ~1 min to index a new Checkout invoice, so Invoice briefly falls back to our PDF. | First live card payment after promotion: confirm the invoice email and the Invoice link | ☐ |
| email-send-receipts.11 | Admin view-as Billing tab | Still shows "Available" rather than Receipt/Invoice links; crew use the roster and the member page Payments panel. | Small follow-up if wanted | ☐ |
| email-send-receipts.12 | osv-scanner red on every branch | New picomatch advisory GHSA-fc5q-39xc-vjpf (17 Nov). Not a required check. A local `npm run build` also stopped on Next.js's own known-vulnerability check after compiling. | Separate dependency-bump PR | ☐ |
| email-send-receipts.13 | Worktrees `../stellr-web-email-send`, `../stellr-web-receipts` | Kept until #776/#777 merge. | `npm run worktrees -- --apply` after the merges | ☐ |
