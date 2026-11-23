# Handover: email events store (email plan, Workstream C) — 2026-11-23

Tracker: `tracker/2026-11-23-email-events-store.md`. Shipped in #916, squashed onto `dev` as `d6a593a0`. **Not promoted.**

## Context

The email plan (Resend Pro, two streams, tenant domains; owner-approved 23 Nov, deadline 31 Dec 2026) has seven workstreams. This session built Workstream C. Before it, the Resend webhook stored only bounces, complaints and suppressions. The owner decided to store every event per recipient, as the engagement base for a future in-portal community email that replaces HubSpot.

A parent session ran Workstreams A and B in parallel: PR A (`email/plan-limits`) adds Resend tags, and #917 adds the two streams and the sender registry. Since 23 Nov, Workstream F is a manual SES warm standby (`EMAIL_PROVIDER` switch), not automatic failover. The `provider` column stays.

## What changed (#916)

- **Migration `20261123200000_email_events.sql`**, applied on the **dev DB only**. The ledger row is realigned to the filename.
  - One row per provider event: provider, provider email id, type (nine types), tenant, member (nullable, `ON DELETE SET NULL`), recipient and its sha256, stream, feature, ref, clicked link (origin and path only), occurred_at, and `payload_min`.
  - Unique on `(provider, provider_email_id, type, occurred_at)`.
  - Access: RLS on. `service_role` has full access. `tenant_app` and the S6 `tenant_support_ro` role can only read, and only their own tenant's rows. `anon` and `authenticated` get nothing.
  - Also adds a partial index on `email_outbox.provider_id`.
  - Registered `own` in `lib/tenancy/registry.ts` and read-only in `lib/tenancy/tenant-role.ts`. Both pgTAP matrices are regenerated, `support_sessions.test.sql` now counts 54 tables, and `lib/database.generated.ts` is regenerated.
- **`lib/email/events.ts`**: `recordEmailEvent()`, `mapResendEvent()` and `pruneEmailEvents()`.
  - Where the context comes from: Resend tags as PR A sends them (`tenant`, `stream` transactional or marketing, `feature`, `ref`; `tenant_id` and `member_id` are read too). Otherwise the outbox row, then the event-email run's `resendId`, then the signing invitation, then Stellr.
  - The member comes from the tag, else the run, else a unique `members` email match.
  - A tagged tenant or member that no longer exists (FK violation) is stored under Stellr and marked `unresolved`.
- **`app/api/webhooks/resend/route.ts`**: events are a third independent consumer. E-sign bounces and the suppression list are unchanged. A failed events write returns 500 so Resend retries.
- **`/api/cron/email-events-retention`**: monthly (3rd of the month, 04:30 UTC), deletes rows older than 13 months, recorded in `cron_runs`. Retention schedule row 37 is added and row 19 cross-references it.
- **Admin History** (Email Engagement tab):
  - Each recipient shows what Resend reported: delivered, delayed, opened or clicked, bounced, spam report, provider suppression or failure.
  - A problem on that message shows as Bounced and puts the send under "needs a look".
  - The CSV gains a "Provider report (UTC)" column.
- **Dashboard `MailHealth`** (platform admins only): 7-day sent, bounced and spam-report counts and rates per stream. It turns amber at ≥4% bounces or ≥0.1% complaints over at least 200 sends.

## Not verified

- **A dev send showing `delivered` rows** in `email_events` and History, which the brief required. Dev receives no Resend events: the only webhook is production's, subscribed to bounced, complained and suppressed only (`email-events-store.1`).
- **The History tab and the dashboard panel were not viewed in a browser.** Unit tests cover the logic and rendering inputs; CI's e2e suite passed but does not exercise these views with event data (`email-events-store.3`).
- **The dev deployment of `d6a593a0`** was still building when this was written (`email-events-store.4`).
- The pgTAP changes were proven only in CI (no local `psql`).

## Open items

See the tracker file. The production migration (`email-events-store.2`) must run through the `Production migration` Action before the promotion that carries #916.
