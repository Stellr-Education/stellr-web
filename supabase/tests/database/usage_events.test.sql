-- pgTAP: S6-USE usage_events, usage_daily and usage_rollup() (migration
-- 20261123023107_usage_events).
--
-- Runs in the `db` job of .github/workflows/ci.yml. Covers: RLS on both tables;
-- only service_role holds privileges (anon and authenticated none; tenant_app is
-- asserted by the generated tenant_isolation matrix); the function runs as its
-- caller and only service_role may execute it; the CHECKs refuse a bad kind and a
-- zero count; and the gate: the roll-up's totals equal the raw SQL counts per
-- tenant and kind, run twice with the same answer.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(28);

-- ── 1. Shape and RLS ────────────────────────────────────────────────────────
SELECT has_table('public', 'usage_events', 'usage_events exists');
SELECT has_table('public', 'usage_daily', 'usage_daily exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.usage_events'::regclass), 'usage_events has RLS on');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.usage_daily'::regclass), 'usage_daily has RLS on');
SELECT col_is_pk('public', 'usage_daily', ARRAY['tenant_id', 'day', 'kind'], 'usage_daily is keyed by (tenant_id, day, kind)');
SELECT hasnt_column('public', 'usage_events', 'member_id', 'usage_events holds no person id');

-- ── 2. Table privileges ─────────────────────────────────────────────────────
SELECT ok(NOT has_table_privilege('anon', 'public.usage_events', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'anon has no privilege on usage_events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.usage_events', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'authenticated has no privilege on usage_events');
SELECT ok(NOT has_table_privilege('anon', 'public.usage_daily', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'anon has no privilege on usage_daily');
SELECT ok(NOT has_table_privilege('authenticated', 'public.usage_daily', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'), 'authenticated has no privilege on usage_daily');
SELECT ok(has_table_privilege('service_role', 'public.usage_events', 'SELECT, INSERT, DELETE'), 'service_role may read, insert and purge usage_events');
SELECT ok(NOT has_table_privilege('service_role', 'public.usage_events', 'UPDATE, TRUNCATE'), 'service_role may not rewrite or truncate usage_events');
SELECT ok(has_table_privilege('service_role', 'public.usage_daily', 'SELECT, INSERT, UPDATE'), 'service_role may read and upsert usage_daily');
SELECT ok(NOT has_table_privilege('service_role', 'public.usage_daily', 'DELETE, TRUNCATE'), 'service_role may not delete usage_daily (roll-ups are kept)');

-- ── 3. The function ─────────────────────────────────────────────────────────
SELECT has_function('public', 'usage_rollup', ARRAY['date'], 'usage_rollup(date) exists');
SELECT isnt_definer('public', 'usage_rollup', ARRAY['date'], 'usage_rollup is not SECURITY DEFINER');
SELECT ok(has_function_privilege('service_role', 'public.usage_rollup(date)', 'EXECUTE'), 'service_role can execute usage_rollup');
SELECT ok(NOT has_function_privilege('anon', 'public.usage_rollup(date)', 'EXECUTE'), 'anon cannot execute usage_rollup');
SELECT ok(NOT has_function_privilege('authenticated', 'public.usage_rollup(date)', 'EXECUTE'), 'authenticated cannot execute usage_rollup');

-- ── 4. CHECKs ───────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$INSERT INTO public.usage_events (tenant_id, kind) VALUES ('00000000-0000-4000-8000-000000000001', 'page_view')$$,
  '23514', NULL, 'a kind outside the four is refused');
SELECT throws_ok(
  $$INSERT INTO public.usage_events (tenant_id, kind, count) VALUES ('00000000-0000-4000-8000-000000000001', 'email', 0)$$,
  '23514', NULL, 'a zero count is refused');
SELECT throws_ok(
  $$SELECT public.usage_rollup(((now() AT TIME ZONE 'UTC')::date - 120))$$,
  '22023', NULL, 'a day outside the 90-day raw window is refused');

-- ── 5. The gate: roll-up totals equal the SQL counts ────────────────────────
-- A second tenant, left in 'provisioning' so the readiness lock does not apply.
INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone, status) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'pgtap-s6-use', 'S6 Use Pty Ltd', 'S6 Use', 'AU', 'AU', 'aud', 'Australia/Sydney', 'provisioning');

-- Yesterday (UTC), with one row on each edge of the day that must be left out.
CREATE TEMP TABLE s6_day ON COMMIT DROP AS
  SELECT (now() AT TIME ZONE 'UTC')::date - 1 AS d;
CREATE TEMP TABLE s6_bounds ON COMMIT DROP AS
  SELECT (d::timestamp AT TIME ZONE 'UTC') AS from_ts, ((d + 1)::timestamp AT TIME ZONE 'UTC') AS to_ts FROM s6_day;

INSERT INTO public.usage_events (tenant_id, kind, occurred_at, count)
SELECT t, k, b.from_ts + interval '1 hour' * h, c
FROM s6_bounds b,
  (VALUES
    ('00000000-0000-4000-8000-000000000001'::uuid, 'registration', 1, 1),
    ('00000000-0000-4000-8000-000000000001'::uuid, 'registration', 5, 1),
    ('00000000-0000-4000-8000-000000000001'::uuid, 'email', 2, 3),
    ('00000000-0000-4000-8000-000000000001'::uuid, 'event', 23, 1),
    ('a6000000-0000-4000-8000-000000000001'::uuid, 'registration', 4, 1),
    ('a6000000-0000-4000-8000-000000000001'::uuid, 'email', 6, 2),
    ('a6000000-0000-4000-8000-000000000001'::uuid, 'email', 7, 1)
  ) AS v(t, k, h, c);
-- Outside the day: the instant it ends, and one microsecond before it begins.
INSERT INTO public.usage_events (tenant_id, kind, occurred_at)
SELECT 'a6000000-0000-4000-8000-000000000001', 'email', b.to_ts FROM s6_bounds b
UNION ALL
SELECT 'a6000000-0000-4000-8000-000000000001', 'email', b.from_ts - interval '1 microsecond' FROM s6_bounds b;
-- Two members created yesterday: the owner's identities.
INSERT INTO public.members (id, first_name, last_name, email, event_role, clerk_user_id, created_at)
SELECT v.id::uuid, 'S6', v.last, v.email, 'participant', v.clerk, b.from_ts + interval '3 hours'
FROM s6_bounds b, (VALUES
  ('a6000000-0000-4000-8000-0000000000a1', 'Alpha', 's6-use-alpha@example.test', 'user_s6usepgtap_alpha'),
  ('a6000000-0000-4000-8000-0000000000a2', 'Bravo', 's6-use-bravo@example.test', 'user_s6usepgtap_bravo')
) AS v(id, last, email, clerk);

-- The SQL counts, computed independently of the function.
CREATE TEMP TABLE s6_expected ON COMMIT DROP AS
  SELECT tenant_id, kind, sum(n)::bigint AS total FROM (
    SELECT e.tenant_id, e.kind, e.count::bigint AS n
      FROM public.usage_events e, s6_bounds b
     WHERE e.occurred_at >= b.from_ts AND e.occurred_at < b.to_ts
    UNION ALL
    SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'identity', count(*)::bigint
      FROM public.members m, s6_bounds b
     WHERE m.created_at >= b.from_ts AND m.created_at < b.to_ts
  ) s GROUP BY tenant_id, kind HAVING sum(n) > 0;

SELECT is(public.usage_rollup((SELECT d FROM s6_day)), (SELECT count(*)::int FROM s6_expected), 'the roll-up writes one row per tenant and kind with usage');

SELECT set_eq(
  $$SELECT tenant_id, kind, total FROM public.usage_daily WHERE day = (SELECT d FROM s6_day)$$,
  $$SELECT tenant_id, kind, total FROM s6_expected$$,
  'the roll-up totals equal the SQL counts, per tenant and kind');

SELECT results_eq(
  $$SELECT kind, total FROM public.usage_daily WHERE day = (SELECT d FROM s6_day) AND tenant_id = 'a6000000-0000-4000-8000-000000000001' ORDER BY kind$$,
  $$VALUES ('email'::text, 3::bigint), ('registration'::text, 1::bigint)$$,
  'the second tenant: 3 emails and 1 registration, the edge rows left out');

-- Idempotent: a second run gives the same rows and totals.
SELECT is(public.usage_rollup((SELECT d FROM s6_day)), (SELECT count(*)::int FROM s6_expected), 'a second run writes the same number of rows');
SELECT set_eq(
  $$SELECT tenant_id, kind, total FROM public.usage_daily WHERE day = (SELECT d FROM s6_day)$$,
  $$SELECT tenant_id, kind, total FROM s6_expected$$,
  'after a second run the totals still equal the SQL counts');

-- ── 6. As an API role ───────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.usage_rollup((now() AT TIME ZONE 'UTC')::date);
    RESET ROLE;
    PERFORM set_config('s6_use_test.anon', 'called', true);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    PERFORM set_config('s6_use_test.anon', '42501', true);
  END;
END $$;
SELECT is(current_setting('s6_use_test.anon'), '42501', 'anon calling usage_rollup is refused');

SELECT * FROM finish();
ROLLBACK;
