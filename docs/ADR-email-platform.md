# ADR: Email platform (Resend Pro, SES warm standby, tenant domains)

**Status:** accepted, 23 Nov 2026 (owner). Built in email plan PRs A–G, #914–#925 and this PR, on `dev`; not yet promoted.
**Supersedes:** `docs/PLAN-single-email-domain.md` (one domain on Resend Free), and the "one shared email pool until SES" decision of 9 Nov 2026 (`docs/TENANCY-S5.md`, Owner gates).

## Context

Every sender was built for Resend Free: one verified domain, 100 emails a day, 3,000 a month, and one shared budget for every tenant. Resend approved nonprofit pricing, and multi-tenancy needs tenants to send from their own domains. The deadline was 31 Dec 2026.

## Decisions

1. **Resend Pro is the main sender.** It has no daily cap, 50,000 emails a month and 10 domains, at about $120 a year after the discount. It was already integrated, and it gives Forge, the dashboard log, idempotency, signed webhooks and support. SES would save about $100 a year, but the team is small and SES needs more care to keep deliverability, so the saving doesn't pay for the risk.
2. **Amazon SES is a warm standby, switched on by hand.** `EMAIL_PROVIDER=ses` in Vercel, then redeploy. There is no automatic failover. A second automatic path would add a webhook, a circuit breaker and SES DKIM for every tenant domain, each able to break unnoticed, to cover a rare outage. On SES, all transactional mail goes from `mail.stellreducation.org` ("Tenant via Stellr" for tenants) and community mail waits in the outbox. AWS access is a Vercel OIDC role, so there are no long-lived keys. Runbook and quarterly drill: `docs/RUNBOOK-email-standby.md`.
3. **Two streams, two domains.**
   - Transactional mail goes from `mail.stellreducation.org`, with Forge and no tracking.
   - Community and marketing mail goes from `community.stellreducation.org`, with open and click tracking and one-click unsubscribe.
   - Event logistics mail to registered families is transactional. An event email marked promotional is community mail, and only Stellr may send one.
4. **Tenants send from their own verified domain.** A platform admin adds and checks it from the super-admin console. Without one, the tenant keeps "Tenant via Stellr". Replies always go to the tenant. Each tenant domain uses one of Pro's 10 domain slots; Stellr uses 2.
5. **Tenant bulk mail is capped and watched, not auto-paused.**
   - Platform admins set daily and monthly caps on each tenant's event blasts, and can pause them.
   - A daily cron flags a tenant whose complaints reach 0.1% or whose hard bounces reach 4%, once it has reached 200 people, and emails staff.
   - Mail to one person (receipts, consent forms) is never capped.
6. **Every provider event is stored** in `email_events` (both providers), keyed by tenant, member, stream, feature and ref, for 13 months. This is the engagement record the portal reads.
7. **Event mail signs off as its sender.** Stellr's event mail keeps its signature. A tenant's signs off with the plain-text signature and logo set in the console (`lib/event-emails/signature.ts`), or with its sender name. The console stores text only and the HTML is built and escaped in code, so nothing typed into the console can add markup to an email.
8. **Contacts and consent stay on `members` in Supabase.** Resend is only the transport. We don't adopt Resend Contacts, Audiences or Broadcasts.

## For later: bringing HubSpot community email into the portal

Not built. It builds on the parts this ADR set up:
- the community stream and its domain;
- `email_events` keyed by member and tenant;
- per-tenant caps;
- contacts on `members`.

The work will replace the single `members.marketing_consent` boolean with topic preferences on `members`, and will send through `sendEmail` with `kind: 'marketing'`.

## When to revisit

- **Make SES the main sender** if Resend has an outage of more than 4 hours, or pauses the account, twice in 12 months.
- **Make SES the main sender** if volume passes 50,000 a month (Resend overage is $0.90 per 1,000).
- **Move some tenants to SES only** if more than 8 domains are in use, rather than buying Resend Scale.
- **Keep the monthly cap below the plan:** keep `EMAIL_MONTHLY_CAP` under 50,000.
