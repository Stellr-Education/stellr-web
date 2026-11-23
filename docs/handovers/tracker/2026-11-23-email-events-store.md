# Email events store (email plan, Workstream C) — 2026-11-23

Slug: `email-events-store`. Handover: `HANDOVER-email-events-store-2026-11-23.md`. Doc snapshot: `1u1oYN-ZUkk0-zGdMmq2ZsBF5g6Uq3zt_1d0F22IPoFw`.
PR #916 → `dev` as `d6a593a0`; not promoted. Migration: `20261123200000_email_events.sql` (dev DB only).

Every Resend event is now stored per message in `email_events` through the webhook, shown per recipient in History and as 7-day rates on the dashboard, and pruned after 13 months.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| email-events-store.1 | Dev send shows `delivered` rows in `email_events` and History | Not done. The only Resend webhook is production's and sends bounced, complained and suppressed only; dev gets no events (checked with Resend `list-webhooks`, 23 Nov) | Owner: subscribe the prod webhook to all email events, and add a dev webhook whose signing secret is set as `RESEND_WEBHOOK_SECRET` on `stellr-web-dev`. Then send to a safelisted address on dev and check both | ☐ |
| email-events-store.2 | Production migration `20261123200000_email_events.sql` | Applied on dev only (grants, RLS and ledger checked with SQL, 23 Nov) | Run it through the `Production migration` Action before promoting #916 | ☐ |
| email-events-store.3 | History tab and dashboard rates viewed in a browser | Not viewed; unit tests only | Once `.1` produces rows, open an event's Email Engagement tab and `/admin` on dev as a platform admin | ☐ |
| email-events-store.4 | Dev deployment of `d6a593a0` | Building when written (`vercel ls stellr-web-dev`, 23 Nov) | Check it is Ready | ☐ |
| email-events-store.5 | Erasure: a hard-deleted member's events keep the address until the 13-month prune | Retention schedule row 37 marks it "to confirm" | Owner decides whether erasure deletes the member's `email_events` rows; if so, add it to the deletion registry | ☐ |
| email-events-store.6 | Brief items 1–5 (migration, `recordEmailEvent`, prune cron + retention doc, History + MailHealth, unit tests) | Built, all 19 CI checks green on #916 incl. pgTAP and e2e steps; full unit suite, `lint:tokens`, `lint:pii` pass | — | ☑ |
