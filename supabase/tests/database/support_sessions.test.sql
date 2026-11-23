-- pgTAP: S6-SUP support sessions and the read-only support role
-- (supabase/migrations/20261123023124_support_sessions.sql; docs/S6-DESIGN.md section 2).
--
-- Runs in the CI `db` job. Everything rolls back.
--
--   1. tenant_support_ro cannot escape RLS, log in or create anything.
--   2. It holds no write privilege on any table, column or sequence in public or
--      entitlements, and cannot execute any SECURITY DEFINER function there.
--   3. It reads exactly the tables tenant_app reads, each under support_read and
--      support_read_guard, with the same USING expression as tenant_app's policy.
--   4. Pinned to one tenant it sees that tenant's rows only, on every readable table;
--      pinned to nothing it sees nothing; every write it tries is refused.
--   5. support_sessions is service_role only, and refuses a short reason, a window
--      over 60 minutes and the platform-owner tenant.
BEGIN;
SET LOCAL search_path = extensions, public;
SET LOCAL row_security = on;
-- Let the runner become tenant_support_ro (rolled back with everything else). Granted
-- by NAME, as in tenant_isolation.test.sql (supautils and the bare CURRENT_USER spec).
DO $grant$ BEGIN
  EXECUTE format('GRANT %I TO %I', 'tenant_support_ro', current_user);
END $grant$;

SELECT plan(28);

-- ── 1. The role ─────────────────────────────────────────────────────────────

SELECT ok(EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_support_ro'), 'role tenant_support_ro exists');
SELECT ok((SELECT NOT (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication) AND NOT rolinherit
  FROM pg_roles WHERE rolname = 'tenant_support_ro'),
  'tenant_support_ro: no BYPASSRLS, no superuser, no login, cannot create roles or databases, NOINHERIT');
SELECT is_empty($q$
  SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
  WHERE m.member = 'tenant_support_ro'::regrole
$q$, 'tenant_support_ro is a member of no role (it inherits nobody''s grants, tenant_app''s included)');

-- ── 2. No write anywhere ────────────────────────────────────────────────────

SELECT is_empty($q$
  SELECT format('%I.%I', n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'entitlements') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege('tenant_support_ro', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         OR has_any_column_privilege('tenant_support_ro', c.oid, 'INSERT, UPDATE, REFERENCES'))
$q$, 'tenant_support_ro holds no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any table or column in public or entitlements');
SELECT is_empty($q$
  SELECT format('%I.%I', n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'entitlements')
    -- CASE, not AND: Postgres need not evaluate AND left to right, and the function
    -- raises on a relation that is not a sequence.
    AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('tenant_support_ro', c.oid, 'USAGE, UPDATE') ELSE false END
$q$, 'tenant_support_ro holds no USAGE or UPDATE on any sequence');
SELECT is_empty($q$
  SELECT p.oid::regprocedure::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'entitlements') AND p.prosecdef
    AND has_function_privilege('tenant_support_ro', p.oid, 'EXECUTE')
$q$, 'tenant_support_ro cannot execute any SECURITY DEFINER function in public or entitlements');
SELECT ok(NOT has_schema_privilege('tenant_support_ro', 'public', 'CREATE'), 'tenant_support_ro cannot create objects in public');
SELECT ok(has_function_privilege('tenant_support_ro', 'public.app_tenant_id()', 'EXECUTE'), 'tenant_support_ro can read the pin (public.app_tenant_id())');

-- ── 3. The same tables as tenant_app, under its own policies ────────────────

CREATE TEMP TABLE sup_tables ON COMMIT DROP AS
  SELECT c.oid AS rel, format('%I.%I', n.nspname, c.relname) AS tbl,
         CASE WHEN c.oid = 'public.tenants'::regclass THEN 'id' ELSE 'tenant_id' END AS col
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'entitlements') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege('tenant_support_ro', c.oid, 'SELECT');

SELECT set_eq(
  'SELECT tbl FROM sup_tables',
  $q$SELECT format('%I.%I', n.nspname, c.relname)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'entitlements') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_table_privilege('tenant_app', c.oid, 'SELECT')$q$,
  'tenant_support_ro reads exactly the tables tenant_app reads');
SELECT is((SELECT count(*)::int FROM sup_tables), 54, 'that is 54 tables: the 53 tenant tables and public.tenants');
SELECT is_empty($q$
  SELECT tbl FROM sup_tables s JOIN pg_class c ON c.oid = s.rel WHERE NOT c.relrowsecurity
$q$, 'every table tenant_support_ro reads has row level security on');
SELECT is_empty($q$
  SELECT s.tbl FROM sup_tables s
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname || '.' || p.tablename = s.tbl AND p.policyname = 'support_read'
      AND p.permissive = 'PERMISSIVE' AND p.cmd = 'SELECT' AND p.roles = ARRAY['tenant_support_ro']::name[]
      AND p.qual = (SELECT a.qual FROM pg_policies a
                    WHERE a.schemaname = p.schemaname AND a.tablename = p.tablename
                      AND a.policyname IN ('tenant_isolation', 'tenant_self') AND a.permissive = 'PERMISSIVE'))
$q$, 'every readable table has support_read: PERMISSIVE FOR SELECT TO tenant_support_ro, USING exactly what tenant_app''s permissive policy uses');
SELECT is_empty($q$
  SELECT s.tbl FROM sup_tables s
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname || '.' || p.tablename = s.tbl AND p.policyname = 'support_read_guard'
      AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL' AND p.roles = ARRAY['tenant_support_ro']::name[]
      AND p.qual ~ ('\m' || s.col || ' = \(\s*SELECT (public\.)?app_tenant_id\(\) AS app_tenant_id\)')
      AND p.with_check = 'false')
$q$, 'every readable table has support_read_guard: RESTRICTIVE FOR ALL, capped at the pinned tenant, WITH CHECK (false)');
SELECT is_empty($q$
  SELECT p.schemaname || '.' || p.tablename || ':' || p.policyname FROM pg_policies p
  WHERE 'tenant_support_ro' = ANY (p.roles) AND p.policyname NOT IN ('support_read', 'support_read_guard')
$q$, 'tenant_support_ro is named in no other policy');

-- ── 4. Pinned to one tenant ─────────────────────────────────────────────────
-- A second tenant, provisioning (the readiness lock allows that), one event each, and a
-- platform admin for section 5.

INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone, status)
  VALUES ('5e550000-0000-4000-8000-0000000000b2', 'sup-canary', 'Sup Canary Pty Ltd', 'Sup Canary', 'AU', 'AU', 'aud', 'Australia/Sydney', 'provisioning');
INSERT INTO public.events (tenant_id, slug, sanity_id, title, time_zone, country, currency, grade_system)
  VALUES ('00000000-0000-4000-8000-000000000001', 'sup-a-event', 'sup-a-sanity', 'Sup', 'UTC', 'US', 'usd', 'us_grades');
INSERT INTO public.events (tenant_id, slug, sanity_id, title, time_zone, country, currency, grade_system)
  VALUES ('5e550000-0000-4000-8000-0000000000b2', 'sup-b-event', 'sup-b-sanity', 'Sup', 'UTC', 'US', 'usd', 'us_grades');
INSERT INTO public.platform_admins (clerk_user_id, granted_by) VALUES ('user_supPgtapAdmin1', 'owner');

-- What tenant_support_ro observed: (context, check) -> value. Asserted after RESET ROLE.
CREATE TEMP TABLE sup_obs (ctx text, chk text, v text) ON COMMIT DROP;
-- Runs one statement as the current role: its row count, or ERR:<SQLSTATE>.
CREATE FUNCTION pg_temp.sup_run(q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  EXECUTE q;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR:' || SQLSTATE;
END $f$;
-- Rows of every readable table whose tenant is not the pinned one, summed, as the current role.
CREATE FUNCTION pg_temp.sup_foreign_rows() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN SELECT tbl, col FROM sup_tables LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I IS DISTINCT FROM public.app_tenant_id()', r.tbl, r.col) INTO n;
    total := total + n;
  END LOOP;
  RETURN total::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR:' || SQLSTATE;
END $f$;
GRANT SELECT ON sup_tables TO tenant_support_ro;
GRANT INSERT ON sup_obs TO tenant_support_ro;
GRANT EXECUTE ON FUNCTION pg_temp.sup_run(text) TO tenant_support_ro;
GRANT EXECUTE ON FUNCTION pg_temp.sup_foreign_rows() TO tenant_support_ro;

-- Pinned to the second tenant.
SET LOCAL ROLE tenant_support_ro;
SELECT set_config('stellr.tenant_id', '5e550000-0000-4000-8000-0000000000b2', true);
INSERT INTO sup_obs VALUES ('b', 'foreign_rows', pg_temp.sup_foreign_rows());
INSERT INTO sup_obs VALUES ('b', 'events', (SELECT string_agg(slug, ',' ORDER BY slug) FROM public.events WHERE slug LIKE 'sup-%'));
INSERT INTO sup_obs VALUES ('b', 'tenants', (SELECT string_agg(slug, ',' ORDER BY slug) FROM public.tenants));
INSERT INTO sup_obs VALUES ('b', 'insert', pg_temp.sup_run($s$INSERT INTO public.events (tenant_id, slug, sanity_id, title, time_zone, country, currency, grade_system) VALUES ('5e550000-0000-4000-8000-0000000000b2', 'sup-b-new', 'sup-b-new-sanity', 'Sup', 'UTC', 'US', 'usd', 'us_grades')$s$));
INSERT INTO sup_obs VALUES ('b', 'update', pg_temp.sup_run($s$UPDATE public.events SET title = 'changed' WHERE slug = 'sup-b-event'$s$));
INSERT INTO sup_obs VALUES ('b', 'delete', pg_temp.sup_run($s$DELETE FROM public.events WHERE slug = 'sup-b-event'$s$));
INSERT INTO sup_obs VALUES ('b', 'truncate', pg_temp.sup_run('TRUNCATE public.events'));
INSERT INTO sup_obs VALUES ('b', 'sessions', pg_temp.sup_run('SELECT 1 FROM public.support_sessions'));
-- Pinned to nothing: fail closed.
SELECT set_config('stellr.tenant_id', '', true);
INSERT INTO sup_obs VALUES ('none', 'visible', (SELECT (SELECT count(*) FROM public.events) + (SELECT count(*) FROM public.tenants))::text);
RESET ROLE;
SELECT set_config('stellr.tenant_id', '', true);

SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'foreign_rows'), '0',
  'pinned to a tenant, tenant_support_ro sees no other tenant''s row on any of the 54 tables');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'events'), 'sup-b-event', 'events: it sees its tenant''s event and not Stellr''s');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'tenants'), 'sup-canary', 'tenants: it sees its own tenant row only');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'insert'), 'ERR:42501', 'an INSERT is refused (42501)');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'update'), 'ERR:42501', 'an UPDATE is refused (42501)');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'delete'), 'ERR:42501', 'a DELETE is refused (42501)');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'truncate'), 'ERR:42501', 'a TRUNCATE is refused (42501)');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'b' AND chk = 'sessions'), 'ERR:42501', 'support_sessions itself is unreadable to it (42501)');
SELECT is((SELECT v FROM sup_obs WHERE ctx = 'none' AND chk = 'visible'), '0', 'with no tenant pinned it sees nothing');

-- ── 5. support_sessions ─────────────────────────────────────────────────────

SELECT ok(NOT has_table_privilege('anon', 'public.support_sessions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.support_sessions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND NOT has_table_privilege('tenant_app', 'public.support_sessions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  AND has_table_privilege('service_role', 'public.support_sessions', 'SELECT, INSERT, UPDATE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.support_sessions'::regclass),
  'support_sessions: RLS on, service_role only (no anon, authenticated, tenant_app or tenant_support_ro)');
SELECT throws_ok($s$
  INSERT INTO public.support_sessions (platform_admin_user_id, tenant_id, reason, ends_at)
  VALUES ('user_supPgtapAdmin1', '5e550000-0000-4000-8000-0000000000b2', 'too short', now() + interval '30 minutes')
$s$, '23514', NULL, 'a reason under 20 characters is refused');
SELECT throws_ok($s$
  INSERT INTO public.support_sessions (platform_admin_user_id, tenant_id, reason, ends_at)
  VALUES ('user_supPgtapAdmin1', '5e550000-0000-4000-8000-0000000000b2', 'Ticket 4521: event roster is missing rows', now() + interval '61 minutes')
$s$, '23514', NULL, 'a session longer than 60 minutes is refused');
SELECT throws_ok($s$
  INSERT INTO public.support_sessions (platform_admin_user_id, tenant_id, reason, ends_at)
  VALUES ('user_supPgtapAdmin1', '00000000-0000-4000-8000-000000000001', 'Ticket 4521: event roster is missing rows', now() + interval '30 minutes')
$s$, '23514', 'support_sessions: no support session for the platform-owner tenant', 'a session for the platform-owner tenant is refused');
SELECT lives_ok($s$
  INSERT INTO public.support_sessions (platform_admin_user_id, tenant_id, reason, ends_at)
  VALUES ('user_supPgtapAdmin1', '5e550000-0000-4000-8000-0000000000b2', 'Ticket 4521: event roster is missing rows', now() + interval '60 minutes')
$s$, 'a read session of 60 minutes for another tenant, with a reason, is accepted');

SELECT * FROM finish();
ROLLBACK;
