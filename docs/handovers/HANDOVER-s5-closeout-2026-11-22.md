# Handover: S5 close-out run, 21–22 Nov 2026

Slug `s5-closeout`. This follows `HANDOVER-s5-wave9-2026-11-21.md` and supersedes its section 5 ("Next work"). Trackers: `tracker/2026-11-21-s5-wave9.md` (wave 9 rows) and `tracker/2026-11-11-s5-programme.md` (the programme list, audited against the code on 22 Nov 2026).

## 1. Where things stand (22 Nov 2026, about 02:00Z)

| Switch | Production | dev |
|---|---|---|
| `AUTHZ_SOURCE` | **`shadow` since 22 Nov 2026 01:26Z** (deployment `dpl_82iYC3EoqPzsy7cSVk7YfD5LByTv`; rollback target `dpl_7ZqZQcgqhQPuLnBSe1BRAsTqRVh9`) | unset, so `clerk` |
| `TENANT_DB_ENABLED` / `TENANT_DB_AREAS` | off | `true` / **`events-config:shadow:0.25` since 22 Nov 00:12Z** (P7) |
| `derivation_mode` | `log` | `log`; ENF-dev due on or after **29 Nov 00:06Z** |
| Readiness lock (`.32`) | not applied | not applied (PR open) |
| Everything else | off or default | off or default |

## 2. What this run did

| PR | What | State |
|---|---|---|
| #849 | ENF-dev: the e-sign and check-in e2e fixtures stopped logging rows enforce would refuse; the clock counts only `no_key`, `no_event`, `mismatch`, `error` (WD-ENF amended by the owner) | on dev |
| #851, #852 | Records: dev `tenantDb` health ok, the clock restart, P7 set and its verdict ("clean so far") | on dev |
| #855 | Register: every open S5 question approved as recommended (owner, 22 Nov: "proceed with your recommendations for anything that's waiting on me"); wave 9 asks answered (shadow on production, BF-33 accepted, the 2 `platform_destined` routes kept, real tenant hosts held) | on dev |
| #857 | PR721-1: "Not you?" at the check-in door writes no audit event; listed in `AUDIT_EXEMPTIONS` | on dev |
| #859 | PR705-1: two S5 tests added to CODEOWNERS | **needs the owner's review** |
| #860 | `.32` readiness lock: migration `20261122020000`, `ISOLATING_SWITCHES`, the health route's `readiness` block | **needs the owner's review** (CODEOWNERS); CI rerunning after the types fix |
| #861 | `.41`: the backfill draft folded into the register: 93 rows in 11 new gate sections, 12 settled with evidence, **81 open**. The 22 Nov blanket yes did not reach them; they sit after the "Owner answers, 22 Nov 2026" section so they cannot read as approved | open, auto-merge |
| this PR | Handover; `.35` evidence; 16 programme rows ticked from the 22 Nov audit | — |

Also, without a PR:
- **Production `AUTHZ_SOURCE=shadow`**, set with the Vercel CLI and redeployed. www 200, app 307 after it.
- **dev `TENANT_DB_AREAS=events-config:shadow:0.25`**: 24 companies reads, 0 `app_errors`, and a `tenant_app_login` backend during the reads. This was the first `tenantDb` shadow read on a hosted deployment.
- **The ENF-dev fix checked on the dev database.** The `e2e-signing` mirror row appeared at 00:00:57Z, and no row that enforce would refuse has been logged since.

## 3. Waiting on the owner

| Ask | Why |
|---|---|
| Review and merge **#860** (readiness lock) and **#859** (CODEOWNERS) | Both touch CODEOWNERS-owned files. T-32, the lock's switch set, was approved as recommended on 22 Nov 2026 |
| Production `AUTHZ_SOURCE=shadow`: run `npx tsx scripts/map-tenancy-roles.ts --check --production`, sign in on production as an admin and as an event manager, open an event, then read `authz_%` rows in `app_errors` (`docs/AUTHZ.md`, runbook steps 1, 3, 4). Watch for 7 days; `postgres` only after a clean week | Agents cannot read production |
| Active CPU on `stellr-web-dev` about 24 h after 22 Nov 00:12Z (P7) | P7 stays at 0.25 until it is read |
| The event-manager half of `.35`'s C16 row; a real registration of each kind on dev; the A8 roster round; the Stripe shared-cost drill | Each needs a person, or a session Claude does not have |
| Confirm the Clerk key `role-mapping-temp` is deleted (`s5-wave9.9`); the production backup routine (`.16`); agent rules for the migration Action (`.2`); `tenant-db` required on `main` (`.5`) | Owner-only settings |
| The 81 open rows #861 brought into the register (`.41`), about 5 at a time. Four (BF-4, BF-45, SQ-5, SQ-16) may already be covered by the owner's 20 Nov "proceed with all recommendations" on the wave 8 table; the owner says. The wave 8 `WD-2` to `WD-6`, `WD-8` and `WD-9` rows are not in the register at all (the wave 9 handover says otherwise) | They were not in the register on 22 Nov |

## 4. Next work for a session, in order

1. **After #860 merges:** apply `20261122020000_tenancy_readiness_lock.sql` to the **dev** database (MCP `apply_migration`, then realign the ledger version; see the Supabase memory notes). Read the dev health `readiness` block: `lock` `closed`, `activeOtherTenants` 0. For production, the migration goes through the Production migration Action before the promotion that carries the code.
2. **P9 preparation:** about 400 companies-screen reads on dev at 0.25 give 100 or more comparisons. Read `TENANTDB` rows after; then ask for the owner's yes on `events-config:shadow:1`.
3. **ENF-dev on or after 29 Nov 00:06Z:** run the "ENF-dev clock" query in `supabase/tests/s5_watch_only.sql` with `flip_at` = `2026-11-22 00:05:58Z`. Empty means set `derivation_mode='enforce'` on dev only. Then K9, which first needs the owner to open the readiness lock on dev for the canary tenant.
4. **A10c / F10** after P9 is clean (WD-9).
5. **C18 leftovers** (`.55`): move a participant between companies through `tenantDb` (needs `tenant_app` column grants on `participants`), and Auto-Assign and the overrides on tenant events. Both fail closed for tenant staff today.
6. **Not blockers:**
   - `.49`: the head count for held rows, and folding the sweeps back into `lib`. Deferred to S9, because the held read returns nothing while Stellr is the only tenant, and the route's copies already do more than the `lib` ones.
   - `.40`: mutation score 73% against a gate of 80%.
   - `.45`: stale baselines.
   - `.46`: the risk register re-score.
   - The last authz idiom (`NavUserButton`).
   - S6.

## 5. Not verified

- **#860's CI.** The first run stopped at the types check (fixed). The rerun's `db` job applied the migration and ran pgTAP. `tenant-db` failed on an `npm ci` download (ffmpeg, HTTP 403), an infrastructure flake, and was re-run.
- **Production shadow decisions.** No production session has exercised an admin route since the flip, so no `authz_mismatch` evidence exists yet.
- **The crew check-in race fix (#849).** It is intermittent; one clean e2e run doesn't prove it. The ENF-dev clock query shows it over the week.

## 6. Things a new session should know

- **A dev redeploy of the same commit is skipped** by `scripts/vercel-ignore-build.sh`, and so is a merge that touches only docs or tests. To make a flip live, put `[build]` in a commit message on dev (the squash subject works; #851 did it).
- **`vercel link` writes the project's variables to `.env.local`.** Link the dev project in a scratch folder and delete the file at once.
- **The admin health route needs a fresh Clerk session.** Load an HTML admin page before calling JSON routes from the browser, or the short-lived token has expired and the call answers 401 or 403.
- **The audit-coverage gate counts every DELETE as a mutation,** even one that only clears a cookie. Dropping an audit event means an `AUDIT_EXEMPTIONS` entry with the owner's decision.
- **A BEFORE trigger fires before CHECK constraints,** so a lock trigger masks the codes other tests expect. Open the lock first in any fixture that inserts a tenant.

## 7. Addendum, 22 Nov 2026 (later the same night)

- **Merged:** #859 (CODEOWNERS, with the owner's yes in chat), #861 (register backfill), #864 (the 81 backfill rows approved), #865 (wave 8 `WD` rows entered). **T-32 approved.** Every S5 decision is now in the register, and none is open.
- **The repository moved** to `Stellr-Education/stellr-web`; the main checkout's `origin` now points there.
- **#860, the readiness lock:** `db` and `tenant-db` are green. `canary-local` needed the lock opened on CI's local stack, which is now done by `seed-two-tenants.ts --ci-open-readiness-lock` (loopback only). Needs the owner's review.
- **#866, the C18 participant move,** goes through the `events-config` area (`tenant_app` already holds UPDATE on `participants`). Needs the owner's review. Auto-Assign and the overrides wait for A10c.
- **P9 preparation:** 400 counted companies reads on dev, all 200, and 0 `app_errors` (flip log). P9 itself waits for the owner's yes and the meter read.
- **P7 meter:** the CLI cannot read Hobby billing data, so the owner reads Active CPU in the dashboard.
- **The `.35` registrations are paused for the owner.** The local app holds a real HubSpot token and a live Resend key, so a test registration would write to the real CRM and send mail to fake addresses. Proposed: run the local app with those two keys blank, then do one registration of each kind, one A8 roster round and the Stripe shared-cost drill on localhost (Stripe test mode). Test payments may not be made on the hosted dev site.

## 8. Addendum, 22 Nov 2026, about 03:40Z

- **#860 and #866 merged.** The readiness lock migration is applied to the **dev** database (ledger realigned to `20261122020000`); the lock is closed and both triggers exist.
- **Vercel stopped deploying on merges after the repository move** (no deployment exists for any commit after about 03:00Z; the projects still name `aussie-spaceman/stellr-web`). This affects production promotions too. **Owner:** reconnect each Vercel project's Git link to `Stellr-Education/stellr-web`.
- **Until then, deploy dev from the API**, which builds from GitHub: `vercel api /v13/deployments -X POST` with `{"name":"stellr-web-dev","project":"<dev project id>","target":"production","gitSource":{"type":"github","repoId":1258717958,"ref":"dev","sha":"<full sha>"}}`. A plain `vercel deploy` upload fails, because the prebuild's `git ls-files` needs `.git`. That is how `dpl_6mMhaDm4W6hGXE9touSubYiLLpCJ` (`464a4b3e`) went live at 03:41Z.
- **Dev health after it:** `readiness` reads lock `closed`, `activeOtherTenants` 0, all six isolating switches `missing`, `violation` false. P7 is still `events-config:shadow:0.25`; config url and ca are `ok`.
- **The `.35` registration rows are blocked:** dev reads the production Sanity dataset, whose events carry live Stripe prices (#868).

## 9. Addendum, 22 Nov 2026, afternoon

- **Merge deploys are reconnected (about 17:50Z).** The projects' Git link still pointed at the original June connection through the personal GitHub installation, so after the repository moved to `Stellr-Education`, GitHub's events no longer reached them (the last Git-sourced deployment was 02:04Z). The owner disconnected and reconnected both projects to `Stellr-Education/stellr-web` through the organisation's Vercel installation. The API now reads org `Stellr-Education`; `stellr-web` tracks `main` and `stellr-web-dev` tracks `dev` (reconnecting had set dev to `main`, corrected by hand). The API-deploy workaround in section 8 is no longer needed.
- **P9 is live on dev** (`events-config:shadow:1`, flip log #871), and #870 (B22 fold) merged.
- **The `.35` money drills ran on localhost** through the dev-only price map (#873): individual and group registrations, a paid shared-cost seat recorded through a replayed test-mode webhook, an A8 roster add, the true-up and unwind refunds. A roster add leaves `participants.payer` NULL by design; #874 pins `payerOf` for that case.
- **The ENF-dev clock was clean at 16:23Z**; the flip waits for 29 Nov 00:06Z.
- **Production shadow checks (owner, about 18:30Z):** `map-tenancy-roles.ts --check --production` reported drift 0; an admin sign-in and an event roster opened; no `AUTHZ %` rows in production `app_errors` since the 01:26Z flip. Still owed: an event-manager sign-in on production. The 7-day watch runs to 29 Nov 01:26Z.

## 10. Close-out, 22 Nov 2026, about 19:30Z

**Nothing from this run is promoted.** Everything is merged into `dev`: #869, #870, #871, #873, #874, #875 and #877. Dev serves `34f191f2` (#873), built from GitHub by the reconnected Vercel link, with no manual deploy.

Gaps, honestly:
- **The dev enforce flip was asked for and not done.** The ENF-dev clock was clean at 16:23Z, but WD-ENF needs seven clean days, so the flip waits for 29 Nov 00:06Z (row `s5-closeout.1`).
- **The production shadow checks are one short.** No event-manager has signed in on production since the flip (row `s5-closeout.2`).
- **The readiness-lock migration is not on production.** `20261122020000_tenancy_readiness_lock.sql` is on the dev DB only. It goes through the Production migration Action before the next promotion (row `s5-closeout.3`).
- **The temporary keys made for the role check have not been confirmed deleted** (row `s5-closeout.4`).
- **The `.35` paid path was proved on the shared-cost group seat, through a replayed webhook.** The individual drill opened a test Checkout, but its payment was not recorded separately. Drill rows stay on the dev DB: an individual registration (now withdrawn) and one shared-cost group, both on a test event's live slug with test-mode Stripe objects (row `s5-closeout.5`).
- **The price map is localhost-only by design.** It is not set on hosted dev, and test payments stay off the hosted dev site.

Tracker: `docs/handovers/tracker/2026-11-22-s5-closeout.md`.
