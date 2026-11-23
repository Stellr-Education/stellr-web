-- pgTAP: S6-BG break-glass (supabase/migrations/20261123144030_support_break_glass.sql;
-- docs/S6-DESIGN.md section 3).
--
-- Runs in the CI `db` job. Everything rolls back. now() is fixed for the transaction,
-- so a lapsed consent is written with times in the past.
--
--   1. support_consents and the three functions are service_role only.
--   2. support_consents refuses the platform owner, a long window and a short reason.
--   3. support_consent_decide: only a tenant_admin of that tenant, never a platform
--      admin, and only once.
--   4. support_break_glass_open: the S6 gate's refusals that live in the database
--      (no consent, no reason), single use, one live session at a time, 30 minutes.
--   5. support_break_glass_renew: once, with a fresh reason, to 60 minutes at most.
--   6. support_sessions: break_glass needs a consent, and only break_glass renews.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(35);

-- Fixtures: a second tenant (provisioning, which the readiness lock allows), two
-- platform admins, a tenant admin, and the second platform admin also made a tenant
-- admin (who must still be refused).
INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone, status)
  VALUES ('5e550000-0000-4000-8000-0000000000c3', 'bg-canary', 'Bg Canary Pty Ltd', 'Bg Canary', 'AU', 'AU', 'aud', 'Australia/Sydney', 'provisioning');
INSERT INTO public.platform_admins (clerk_user_id, granted_by) VALUES ('user_bgPgtapAdmin1', 'owner'), ('user_bgPgtapAdmin2', 'owner');
INSERT INTO public.tenant_memberships (tenant_id, clerk_user_id, role, source) VALUES
  ('5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', 'tenant_admin', 'admin'),
  ('5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapCrew', 'event_manager', 'admin'),
  ('5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin2', 'tenant_admin', 'admin');

-- Consents: a pending one (c1), one by the other admin (c2), a lapsed one (c3), one to
-- decline (c4) and a second for admin 1 (c5).
INSERT INTO public.support_consents (id, tenant_id, platform_admin_user_id, reason, requested_at, expires_at) VALUES
  ('bc000000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin1', 'Ticket 77: fix a stuck registration', now(), now() + interval '24 hours'),
  ('bc000000-0000-4000-8000-0000000000c2', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin2', 'Ticket 78: fix a stuck registration', now(), now() + interval '24 hours'),
  ('bc000000-0000-4000-8000-0000000000c3', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin1', 'Ticket 79: fix a stuck registration', now() - interval '25 hours', now() - interval '1 hour'),
  ('bc000000-0000-4000-8000-0000000000c4', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin1', 'Ticket 80: fix a stuck registration', now(), now() + interval '24 hours'),
  ('bc000000-0000-4000-8000-0000000000c5', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin1', 'Ticket 81: fix a stuck registration', now(), now() + interval '24 hours');

-- ── 1. service_role only ────────────────────────────────────────────────────

SELECT ok(
  NOT has_table_privilege('anon', 'public.support_consents', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('authenticated', 'public.support_consents', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('tenant_app', 'public.support_consents', 'SELECT, INSERT, UPDATE, DELETE')
  AND NOT has_table_privilege('tenant_support_ro', 'public.support_consents', 'SELECT, INSERT, UPDATE, DELETE')
  AND has_table_privilege('service_role', 'public.support_consents', 'SELECT, INSERT, UPDATE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.support_consents'::regclass),
  'support_consents: RLS on, service_role only');
SELECT is_empty($q$
  SELECT r.rolname || ' ' || f.sig
  FROM unnest(ARRAY['anon', 'authenticated', 'tenant_app', 'tenant_support_ro']) AS r(rolname)
  CROSS JOIN unnest(ARRAY[
    'public.support_consent_decide(uuid, uuid, text, boolean)',
    'public.support_break_glass_open(uuid, text, text)',
    'public.support_break_glass_renew(uuid, text, text)',
    'public.support_consent_withdraw(uuid, uuid)']) AS f(sig)
  WHERE has_function_privilege(r.rolname, f.sig, 'EXECUTE')
$q$, 'only service_role can execute the break-glass functions');
SELECT ok(
  has_function_privilege('service_role', 'public.support_consent_decide(uuid, uuid, text, boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.support_break_glass_open(uuid, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.support_break_glass_renew(uuid, text, text)', 'EXECUTE'),
  'service_role can execute the break-glass functions');
SELECT is_empty($q$
  SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND p.proname IN ('support_consent_decide', 'support_consent_withdraw', 'support_break_glass_open', 'support_break_glass_renew', 'support_consents_refuse_owner')
$q$, 'the break-glass functions are SECURITY INVOKER');

-- ── 2. support_consents' checks ─────────────────────────────────────────────

SELECT throws_ok($s$
  INSERT INTO public.support_consents (tenant_id, platform_admin_user_id, reason, expires_at)
  VALUES ('00000000-0000-4000-8000-000000000001', 'user_bgPgtapAdmin1', 'Ticket 77: fix a stuck registration', now() + interval '1 hour')
$s$, '23514', 'support_consents: no break-glass for the platform-owner tenant', 'a consent request for the platform owner is refused');
SELECT throws_ok($s$
  INSERT INTO public.support_consents (tenant_id, platform_admin_user_id, reason, expires_at)
  VALUES ('5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin1', 'Ticket 77: fix a stuck registration', now() + interval '25 hours')
$s$, '23514', NULL, 'a consent request lasting more than 24 hours is refused');
SELECT throws_ok($s$
  INSERT INTO public.support_consents (tenant_id, platform_admin_user_id, reason, expires_at)
  VALUES ('5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin1', 'too short', now() + interval '1 hour')
$s$, '23514', NULL, 'a consent request with a reason under 20 characters is refused');

-- ── 3. Deciding ─────────────────────────────────────────────────────────────

SELECT throws_ok($s$ SELECT public.support_consent_decide('bc000000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapCrew', true) $s$,
  '42501', 'only an admin of this tenant can answer a break-glass request', 'an event manager of the tenant cannot consent');
SELECT throws_ok($s$ SELECT public.support_consent_decide('bc000000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapStranger', true) $s$,
  '42501', 'only an admin of this tenant can answer a break-glass request', 'someone with no membership cannot consent');
SELECT throws_ok($s$ SELECT public.support_consent_decide('bc000000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin2', true) $s$,
  '42501', 'a platform admin cannot answer a break-glass request', 'a platform admin cannot consent, even as a tenant admin');
SELECT throws_ok($s$ SELECT public.support_consent_decide('bc000000-0000-4000-8000-0000000000c3', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', true) $s$,
  '55000', 'this break-glass request has lapsed', 'a lapsed request cannot be approved');
SELECT throws_ok($s$ SELECT public.support_consent_decide('bc000000-0000-4000-8000-0000000000ff', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', true) $s$,
  'P0002', 'no such break-glass request', 'an unknown request is refused');
SELECT throws_ok($s$ SELECT public.support_consent_decide('bc000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'user_bgPgtapTenantAdmin', true) $s$,
  'P0002', 'no such break-glass request', 'a request is answered only on its own tenant');
SELECT is(public.support_consent_decide('bc000000-0000-4000-8000-0000000000c4', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', false),
  '5e550000-0000-4000-8000-0000000000c3'::uuid, 'the tenant admin can decline');
SELECT is(public.support_consent_decide('bc000000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', true),
  '5e550000-0000-4000-8000-0000000000c3'::uuid, 'the tenant admin can approve');
SELECT throws_ok($s$ SELECT public.support_consent_decide('bc000000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', false) $s$,
  '55000', 'this break-glass request has already been answered', 'a request is answered once');
SELECT is((SELECT decided_by_clerk_user_id FROM public.support_consents WHERE id = 'bc000000-0000-4000-8000-0000000000c1'),
  'user_bgPgtapTenantAdmin', 'the approval names who gave it');
-- Approve c2 (admin 2's request) and c5 (admin 1's second) for the open tests.
DO $$ BEGIN
  PERFORM public.support_consent_decide('bc000000-0000-4000-8000-0000000000c2', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', true);
  PERFORM public.support_consent_decide('bc000000-0000-4000-8000-0000000000c5', '5e550000-0000-4000-8000-0000000000c3', 'user_bgPgtapTenantAdmin', true);
END $$;

-- ── 4. Opening ──────────────────────────────────────────────────────────────

SELECT throws_ok($s$ SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c1', 'user_bgPgtapAdmin1', 'too short') $s$,
  '22023', 'break-glass needs a reason of 20 to 500 characters', 'refused without a reason of 20 characters');
SELECT throws_ok($s$ SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c2', 'user_bgPgtapAdmin1', 'Fixing the stuck registration now') $s$,
  '42501', 'no approved, unused consent from this tenant', 'refused on a consent another admin requested');
SELECT throws_ok($s$ SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c4', 'user_bgPgtapAdmin1', 'Fixing the stuck registration now') $s$,
  '42501', 'no approved, unused consent from this tenant', 'refused on a declined consent');
SELECT throws_ok($s$ SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c3', 'user_bgPgtapAdmin1', 'Fixing the stuck registration now') $s$,
  '42501', 'no approved, unused consent from this tenant', 'refused on a lapsed, unanswered consent');
SELECT ok(NOT public.support_consent_withdraw('bc000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-000000000001'),
  'withdraw touches only the named tenant''s request');
SELECT ok(public.support_consent_withdraw('bc000000-0000-4000-8000-0000000000c5', '5e550000-0000-4000-8000-0000000000c3'),
  'an unused request can be withdrawn');
SELECT throws_ok($s$ SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c5', 'user_bgPgtapAdmin1', 'Fixing the stuck registration now') $s$,
  '42501', 'no approved, unused consent from this tenant', 'refused on a withdrawn consent');
UPDATE public.support_consents SET withdrawn_at = NULL WHERE id = 'bc000000-0000-4000-8000-0000000000c5';

CREATE TEMP TABLE bg_open ON COMMIT DROP AS
  SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c1', 'user_bgPgtapAdmin1', '  Fixing the stuck registration now  ');
SELECT ok((SELECT tenant_id = '5e550000-0000-4000-8000-0000000000c3' AND ends_at = now() + interval '30 minutes' FROM bg_open),
  'with an approved consent it opens a 30-minute session on that tenant');
SELECT ok((SELECT mode = 'break_glass' AND consent_id = 'bc000000-0000-4000-8000-0000000000c1' AND reason = 'Fixing the stuck registration now'
  FROM public.support_sessions WHERE id = (SELECT session_id FROM bg_open)),
  'the session is break_glass, names its consent, and keeps the trimmed reason');
SELECT isnt((SELECT used_at FROM public.support_consents WHERE id = 'bc000000-0000-4000-8000-0000000000c1'), NULL, 'the consent is spent');
SELECT throws_ok($s$ SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c5', 'user_bgPgtapAdmin1', 'Fixing the stuck registration now') $s$,
  '55000', 'close the current support session first', 'one live session at a time');
UPDATE public.support_sessions SET closed_at = now() WHERE id = (SELECT session_id FROM bg_open);
SELECT throws_ok($s$ SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c1', 'user_bgPgtapAdmin1', 'Fixing the stuck registration now') $s$,
  '42501', 'no approved, unused consent from this tenant', 'a consent opens one session only');

-- ── 5. Renewing ─────────────────────────────────────────────────────────────

CREATE TEMP TABLE bg_open2 ON COMMIT DROP AS
  SELECT * FROM public.support_break_glass_open('bc000000-0000-4000-8000-0000000000c5', 'user_bgPgtapAdmin1', 'Second task: refund a duplicate charge');
SELECT throws_ok(format($s$ SELECT public.support_break_glass_renew(%L, 'user_bgPgtapAdmin2', 'Still refunding the duplicate charge') $s$, (SELECT session_id FROM bg_open2)),
  '55000', 'no live break-glass session to renew', 'another admin cannot renew it');
SELECT throws_ok(format($s$ SELECT public.support_break_glass_renew(%L, 'user_bgPgtapAdmin1', 'short') $s$, (SELECT session_id FROM bg_open2)),
  '22023', 'a renewal needs a fresh reason of 20 to 500 characters', 'a renewal needs a fresh reason');
SELECT is(public.support_break_glass_renew((SELECT session_id FROM bg_open2), 'user_bgPgtapAdmin1', 'Still refunding the duplicate charge'),
  now() + interval '60 minutes', 'a renewal adds 30 minutes, to 60 at most');
SELECT throws_ok(format($s$ SELECT public.support_break_glass_renew(%L, 'user_bgPgtapAdmin1', 'Still refunding the duplicate charge') $s$, (SELECT session_id FROM bg_open2)),
  '55000', 'a break-glass session renews once', 'a session renews once');

-- ── 6. support_sessions' new checks ─────────────────────────────────────────

SELECT throws_ok($s$
  INSERT INTO public.support_sessions (platform_admin_user_id, tenant_id, reason, mode, ends_at)
  VALUES ('user_bgPgtapAdmin2', '5e550000-0000-4000-8000-0000000000c3', 'Ticket 90: break glass by hand', 'break_glass', now() + interval '30 minutes')
$s$, '23514', NULL, 'a break_glass session without a consent is refused');
SELECT throws_ok($s$
  INSERT INTO public.support_sessions (platform_admin_user_id, tenant_id, reason, ends_at, renewed_at, renewal_reason)
  VALUES ('user_bgPgtapAdmin2', '5e550000-0000-4000-8000-0000000000c3', 'Ticket 91: read the roster', now() + interval '30 minutes', now(), 'Ticket 91: still reading')
$s$, '23514', NULL, 'a read session cannot renew');

SELECT * FROM finish();
ROLLBACK;
