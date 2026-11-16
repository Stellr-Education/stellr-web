-- pgTAP: public.platform_quota_usage() (S1-quota-alarms; migration
-- platform_quota_usage).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in this
-- directory. Covers: the function exists and is SECURITY DEFINER with an empty
-- search_path, it returns one row of non-negative numbers, only service_role
-- holds EXECUTE, and anon and authenticated are refused when they call it.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

-- ── 1. Shape ────────────────────────────────────────────────────────────────
SELECT has_function('public', 'platform_quota_usage', ARRAY[]::text[], 'platform_quota_usage() exists');
SELECT is_definer('public', 'platform_quota_usage', ARRAY[]::text[], 'it is SECURITY DEFINER');
SELECT ok(
  (SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.platform_quota_usage()'::regprocedure),
  'its search_path is empty');

-- ── 2. What it returns ──────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM public.platform_quota_usage()), 1, 'it returns exactly one row');
SELECT ok((SELECT database_bytes > 0 FROM public.platform_quota_usage()), 'database_bytes is a positive number');
SELECT ok((SELECT storage_bytes >= 0 FROM public.platform_quota_usage()), 'storage_bytes is a non-negative number');

-- ── 3. Privileges ───────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('service_role', 'public.platform_quota_usage()', 'EXECUTE'),
  'service_role can execute it');
SELECT ok(NOT has_function_privilege('anon', 'public.platform_quota_usage()', 'EXECUTE'),
  'anon cannot execute it');
SELECT ok(NOT has_function_privilege('authenticated', 'public.platform_quota_usage()', 'EXECUTE'),
  'authenticated cannot execute it');

-- ── 4. As each API role ─────────────────────────────────────────────────────
-- The call runs inside a DO block under the role and records what happened in
-- a transaction-local setting, so the pgTAP calls stay on the test's own role.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      PERFORM * FROM public.platform_quota_usage();
      RESET ROLE;
      PERFORM set_config('pqu_test.' || r, 'called', true);
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      PERFORM set_config('pqu_test.' || r, '42501', true);
    END;
  END LOOP;
END $$;
SELECT is(current_setting('pqu_test.anon'), '42501', 'anon calling it is refused');
SELECT is(current_setting('pqu_test.authenticated'), '42501', 'authenticated calling it is refused');

SELECT * FROM finish();
ROLLBACK;
