# S6 design note: decisions, support mode and break-glass (S6-D)

Written 22 Nov 2026 against `dev` at `419f5a1b`, as slice S6-D of `docs/PLAN-S6-DRAFT.md`. It answers the draft's open questions with the defaults S6 builds until the owner says otherwise, and writes up the support-mode and break-glass design that S6-AW, S6-SUP and S6-BG build. People are named by role only.

**Status.** Docs only. The questions S6-Q2 to S6-Q11 are entered in `docs/S5-DECISION-REGISTER.md`, section "S6 decisions", as **open, default in force**. The owner's 22 Nov 2026 blanket yes (#855) covered the register rows open at that time; these rows were added after it, so it does not cover them. The owner reviews the defaults (the S6-D gate). Built since: S6-AW (22 Nov 2026) and S6-USE (22 Nov 2026, on S6-Q6's default, behind `USAGE_METERING_ENABLED`, off).

## 1. Decisions and the defaults in force

| Id | Question | Default in force | Why this default |
|---|---|---|---|
| S6-Q1 | MFA before Clerk Pro | **Answered (a), 21 Nov 2026.** Built as F4 behind `ADMIN_MFA_ENFORCE` (off) and `ADMIN_STEP_UP_ENFORCE` (off), on production since #882. The MFA flag stays off until Clerk Pro is bought, MFA is enabled and every admin has enrolled | Production Clerk is on the Free plan, which refuses MFA |
| S6-Q2 | Roles that need MFA at request time | Admin and Staff first; event managers next; every portal user with tenant-admin rights once tenant admins exist | Smallest set that covers the people who can read other people's data |
| S6-Q3 | `platform_admins`, route by route | The two platform admins mapped on production on 21 Nov 2026 (wave 9) pass `assertPlatformAdmin`; BF-15 (a)'s seven routes are `platform_admin` only; every other admin route keeps today's Stellr admin check until C25's flip | Matches what is live; no Stellr admin is locked out while `AUTHZ_SOURCE` is `clerk` or `shadow` |
| S6-Q4 | How a tenant consents to break-glass | (a) In-app approval by one of the tenant's admins, logged to the tenant's audit chain. With no tenant admin, break-glass is refused | Consent the tenant can see and the platform cannot forge |
| S6-Q5 | Break-glass time limit | 30 minutes, renewable once with a fresh reason and a fresh step-up | Under the plan's 60-minute ceiling, long enough for one support task |
| S6-Q6 | Usage figures and retention | Counts only (registrations, events, emails, identities), per tenant per day; gross volume and fees once S9 exists. Raw `usage_events` kept 90 days, daily roll-ups kept. **Built as S6-USE, 22 Nov 2026, behind `USAGE_METERING_ENABLED` (off)**: `docs/S5-CRONS-LIMITS-SMMA.md`, "The usage roll-up" | Aggregates first; no personal data in usage |
| S6-Q7 | Where support mode runs | (a) The platform host only. `/admin` stays a 404 on tenant hosts | Keeps support sessions off tenant domains and cookies |
| S6-Q8 | View-as once support mode exists | (a) Kept for Stellr's own members; support mode is the only way into a non-owner tenant. View-as refuses a target tied to a non-owner tenant (BF-40) | View-as acts as a person; support mode acts as staff with a banner and an audit trail |
| S6-Q9 | Is C25's authority flip S6's first production step? | (a) Yes. The flip follows the 7-day production shadow window that ends 29 Nov 2026 01:26Z, with `docs/AUTHZ.md` preconditions 1 to 10 recorded | Support mode and tenant admins both rest on Postgres authority |
| S6-Q10 | The `proxy.ts` admin prefilter under `postgres` (B20) | (a) Sync a Clerk claim from Postgres; the proxy stays database-free | Active CPU: no database call in the proxy for Stellr hosts |
| S6-Q11 | Where the audit chain's recorded heads are kept | (b) Taken by hand at each promotion and written into the promotion record | No new cron until its Active CPU is measured; Vercel Pro now lets the CLI read the meter, so (a) can be revisited |

## 2. Support mode (S6-AW, then S6-SUP)

**What it is.** A platform admin opens a support session for one non-owner tenant, on the platform host. While it is open, every page shows a banner naming the tenant and the session's end time, reads run under a read-only database role, and every mutation is refused.

**Pieces, in build order:**

1. **S6-AW: `assertWritable()` is real.** The mutation wrapper (`withAudit`, which wraps every mutating handler: 302 of 302, `test/baselines/unaudited-mutations.json`) calls `assertWritable()` before an admin handler runs. It refuses with 403 `support_read_only` when the request carries a read-mode support session. Until S6-SUP there is no session store, so it is a null check and passes. A guard test fails on any admin mutation that does not pass through it.
2. **S6-SUP: the session and the role.**
   - A `support_sessions` row: platform admin (by `platform_admins` id), tenant, reason, mode (`read` or `break_glass`), opened at, ends at, closed at. Opening and closing each write a `platform_audit_events` row to **the tenant's** chain, so the tenant sees them on its audit page.
   - A `tenant_support_ro` database role: SELECT only, under the same tenant row policies as `tenant_app`, pinned to the session's tenant by the transaction-local tenant setting (`docs/S4-SPIKE.md`, Option B). pgTAP proves it holds no INSERT, UPDATE, DELETE or TRUNCATE on any table, and no EXECUTE on a function that writes.
   - Reads in a support session go through `tenantDb` opened as `tenant_support_ro`, never the service client. A route that only has a service-client path refuses in support mode rather than falling back.
   - The session cookie is separate from Clerk's, short-lived, signed with its own secret, bound to the admin's Clerk session id, and dropped when that session ends.
3. **What support mode never does:** open on a tenant host (S6-Q7); reach Stellr's own data (Stellr's staff use the ordinary admin screens); show a person's data in the console outside a session (S6-CON shows aggregates only).

## 3. Break-glass (S6-BG)

**What it is.** A support session switched to write mode, for one task, with the tenant's consent.

**The four refusals the S6 gate names, each with a test:**

| Refused when | Check | Where |
|---|---|---|
| No tenant consent | A consent row approved by one of that tenant's admins, for this session, not yet used or expired (S6-Q4) | Opening break-glass |
| No reason | A non-empty reason of at least 20 characters; stored, shown to the tenant | Opening break-glass |
| No step-up | A Clerk re-verification within the last 5 minutes (the F4 step-up check, `ADMIN_STEP_UP_ENFORCE`'s code path, required here whatever the flag says) | Opening and renewing |
| Past the time limit | `ends_at` (30 minutes, S6-Q5) checked on every request; one renewal | Every request, in `assertWritable()` |

In break-glass mode `assertWritable()` passes, writes run under `tenant_app` pinned to the session's tenant (never the service role), and every mutation writes a `platform_audit_events` row to the tenant's chain carrying the session id and the reason. Closing the session, by hand or by time, is audited the same way.

## 4. Order after S6-D

1. **S6-AW** (built in parallel with this note; inert until S6-SUP).
2. **C25's flip** after 29 Nov 2026 01:26Z and the `docs/AUTHZ.md` preconditions (S6-Q9).
3. **S6-SUP**, with its migration written with `npm run migration:new`, proven in CI, applied to the dev database, and to production only through the Production migration Action.
4. **S6-BG**, then **S6-USE** and **S6-CON**. S6-USE was built early (22 Nov 2026), flag off: it needs none of S6-SUP or S6-BG.
5. MFA for tenant admins when Clerk Pro is bought (S6-Q1, plan decision 21).

## 5. Risks carried from the draft

- **Lockout.** The MFA flag and a short `platform_admins` list can each lock Stellr's admins out. Both stay off or permissive until the owner flips them on `dev` first, with the rollback written before the flip.
- **Active CPU.** Support mode adds nothing to the proxy and nothing to a request that is not in a session.
- **Exposure.** Support actions are visible to the tenant and cannot be removed from the chain. That is the point, and also why a mistake in support mode cannot be quietly undone.
