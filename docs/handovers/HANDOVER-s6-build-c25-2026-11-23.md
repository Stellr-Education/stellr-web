# Handover: S6 built on dev, and the authority flip (C25) live on production — 23 Nov 2026

Slug `s6-build-c25`. Tracker: `tracker/2026-11-23-s6-build-c25.md`. People are named by role only.

## The one thing to know first

**Nothing from S6 is promoted except what #898 carried (S6-AW, S6-D).** Everything else below is on `dev` only. Four migrations are on the **dev** database only and must run through the Production migration Action **before** the next promotion, in this order:

1. `20261123023107_usage_events`
2. `20261123023124_support_sessions`
3. `20261123144030_support_break_glass`
4. `20261123160450_console_tenant_errors_flags`

The fourth changes `record_app_error`'s arguments (it gains `p_tenant_id`), and the error capture on `dev` calls the new form. Promoting the code without it would break production's error capture. The owner will promote separately.

**Production is on `AUTHZ_SOURCE=postgres` since 23 Nov 2026 17:47:02Z** (C25, the owner's instruction, ahead of the 7-day shadow window). Rollback: `AUTHZ_SOURCE=shadow` on the `stellr-web` project, then redeploy the newest READY deployment.

## What shipped to `dev` (all squash-merged, CI green)

| PR | Slice | What it is |
|---|---|---|
| #901 | S6-USE | `usage_events`, `usage_daily`, `usage_rollup(day)`; `recordUsage()` behind `USAGE_METERING_ENABLED`; daily `usage-rollup` cron (00:30 UTC) |
| #902 | S6-SUP | `support_sessions`, the `tenant_support_ro` role (SELECT only), signed support cookie, `/api/admin/support/session`, banner, `tenantSupportDb` |
| #906 | S6-BG | `support_consents` and four service_role functions (decide, open, renew, withdraw); `/api/admin/support/consent`, `/api/admin/support/break-glass`, `/api/support-consents/[id]`; strict step-up (5 minutes, whatever `ADMIN_STEP_UP_ENFORCE` says); `assertWritable` refuses an ended session and a break-glass session on a route that has not opted in; `tenantBreakGlassDb` |
| #907 | S6-CON-a | `/admin/platform` (every tenant, counts only) and `/admin/platform/tenants/[id]`; suspend and resume (`/api/admin/platform/tenants/[id]/status`) |
| #908 | S6-SUP-UI | The console's support panel (open and end a read session, ask for break-glass, open and renew it); `/admin/platform/support` read view through `tenantSupportDb`; the first break-glass action, `POST /api/admin/platform/support/company-name` |
| #909 | S6-CON-b | `app_errors.tenant_id` (from the proxy's tenant header, `lib/app-errors-tenant.ts`); `tenant_feature_flags` with one switch, `break_glass_allowed`; console errors and switches panels |
| #904, #910, #911, #912, #913 | docs | Ledger, MFA parked, flip log rows |
| #903 | baselines | ds-lint lock at 3684 |

Earlier the same day (promoted in #898, `e58f5b5c`): S5 A10c's four areas, S6-AW, the signer status lines, F10's window.

## What was verified, and how

- **S6-USE on dev:** the first roll-up equalled the SQL count (identities, 4 for 22 Nov). Registrations, emails and events had no activity, so those kinds are unproven.
- **Support mode and break-glass on dev, end to end, as the owner, through the console** (flip log, "S6 support mode on dev"): read session, support view through `tenant_support_ro`, a write refused `support_read_only`, break-glass requested, approved, opened (strict step-up asked again), team renamed and restored, a non-opted-in route refused `break_glass_unsupported`, closed. The test tenant's audit chain holds all seven steps in order. The approval was recorded through `support_consent_decide` directly (the tenant-host answer route is `pending`, S6-Q12), so it wrote no audit row.
- **C25 on production:** before, 0 `authz_mismatch` rows since 22 Nov 01:26Z, and the tables matched Clerk for every role holder (2 admins who are the 2 platform admins; 1 event manager). After: the owner reached `/admin`, Duties and Events; health reads `postgres`; www 200, app 307, cron 401; `app_errors` 0 rows of any kind from 17:47Z to 18:31Z. These production reads were the owner's one-time permissions, given in chat.
- **Not verified:** an event manager or a member signing in on production under `postgres`.

## Settings changed

- **stellr-web-dev (Vercel, Production target):** `USAGE_METERING_ENABLED=true`, `CRON_NON_PROD_JOBS=usage-rollup`, project crons enabled (were off since 21 Oct), `AUTHZ_SOURCE=postgres`, `SUPPORT_MODE_ENABLED=true`, `SUPPORT_SESSION_SECRET` (Sensitive), `PLATFORM_AUDIT_ENABLED=true`.
- **Dev database:** the four migrations above with ledger rows; roles mapped (`scripts/map-tenancy-roles.ts --apply --platform-admins`: 2 platform admins, 3 Stellr memberships); a provisioning test tenant `support-canary` with one event, one team and a test tenant-admin identity.
- **stellr-web (production):** `AUTHZ_SOURCE=postgres`, redeployed as `dpl_GLbjUcQTBu6wTRNX2T4m5TiZQJAz`.

## Decisions recorded

- MFA enforcement **parked** until Clerk Pro, which waits for the Australian counterparts' commitment (register, S6-Q1 note and S6-Q2).
- S6-Q9 answered: flip now.
- S6-Q12 added: the tenant admin's answer route stays `pending` on tenant hosts until the first tenant-admin account.

## Watch out for

- **The proxy's admin prefilter still reads the Clerk claim** (S6-Q10, B20, not built). Under `postgres`, change roles through the admin screens or `scripts/set-admin.ts`, which keep Clerk and the tables in step, never the Clerk dashboard alone.
- **Break-glass can change one thing only**: an event's team name. Every other admin route refuses a break-glass session until it is moved onto `tenantBreakGlassDb` and opts in.
- Dev now audits every admin mutation (`PLATFORM_AUDIT_ENABLED`) and runs all 33 cron definitions (the guard declines all but `usage-rollup`).
