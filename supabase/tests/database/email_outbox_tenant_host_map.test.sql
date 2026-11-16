-- pgTAP: S5 wave 8 M7 (migrations email_outbox_tenant and tenant_host_map).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in this
-- directory. Covers:
--   * email_outbox.tenant_id: nullable, no default, a foreign key to tenants,
--     indexed; a row queued the way today's code queues it keeps NULL (which
--     counts as Stellr's, WD-2); a row can carry a tenant; an unknown tenant is
--     refused;
--   * tenant_host_map(): SECURITY DEFINER with an empty search_path; returns
--     host and tenant_id only, for active tenants only; only service_role holds
--     EXECUTE (WD-1 not accepted), and anon, authenticated and tenant_app are
--     refused when they call it.
-- Everything rolls back.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(24);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- One tenant per status, each with one host. Stellr (the platform owner) is
-- seeded by 20261104100000 and gets a host too.
INSERT INTO public.tenants (id, slug, legal_name, display_name, country, payment_region, currency, time_zone, min_participant_age, status) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'pgtap-m7-active',    'M7 Active Pty Ltd',    'M7 Active',    'AU', 'AU', 'aud', 'Australia/Sydney', 14, 'active'),
  ('a7000000-0000-4000-8000-000000000002', 'pgtap-m7-suspended', 'M7 Suspended Pty Ltd', 'M7 Suspended', 'AU', 'AU', 'aud', 'Australia/Sydney', 14, 'suspended'),
  ('a7000000-0000-4000-8000-000000000003', 'pgtap-m7-archived',  'M7 Archived Pty Ltd',  'M7 Archived',  'AU', 'AU', 'aud', 'Australia/Sydney', 14, 'archived'),
  ('a7000000-0000-4000-8000-000000000004', 'pgtap-m7-prov',      'M7 Prov Pty Ltd',      'M7 Prov',      'AU', 'AU', 'aud', 'Australia/Sydney', 14, 'provisioning'),
  -- No host: holds only queued mail, so the ON DELETE RESTRICT check is the outbox's own.
  ('a7000000-0000-4000-8000-000000000005', 'pgtap-m7-mail',      'M7 Mail Pty Ltd',      'M7 Mail',      'AU', 'AU', 'aud', 'Australia/Sydney', 14, 'active');

INSERT INTO public.tenant_domains (host, tenant_id) VALUES
  ('m7-active.pgtap.test',    'a7000000-0000-4000-8000-000000000001'),
  ('m7-suspended.pgtap.test', 'a7000000-0000-4000-8000-000000000002'),
  ('m7-archived.pgtap.test',  'a7000000-0000-4000-8000-000000000003'),
  ('m7-prov.pgtap.test',      'a7000000-0000-4000-8000-000000000004'),
  ('m7-stellr.pgtap.test',    '00000000-0000-4000-8000-000000000001');

-- ── 1. email_outbox.tenant_id: shape ────────────────────────────────────────
SELECT has_column('public', 'email_outbox', 'tenant_id', 'email_outbox has tenant_id');
SELECT col_type_is('public', 'email_outbox', 'tenant_id', 'uuid', 'tenant_id is a uuid');
SELECT col_is_null('public', 'email_outbox', 'tenant_id', 'tenant_id is nullable (NULL counts as Stellr''s)');
SELECT col_hasnt_default('public', 'email_outbox', 'tenant_id', 'tenant_id has no default');
SELECT fk_ok('public', 'email_outbox', 'tenant_id', 'public', 'tenants', 'id', 'tenant_id references tenants(id)');
SELECT has_index('public', 'email_outbox', 'email_outbox_tenant_id_idx', ARRAY['tenant_id'], 'tenant_id is indexed');

-- ── 2. email_outbox.tenant_id: rows ─────────────────────────────────────────
-- Queued the way lib/email/outbox.ts queues today: no tenant_id, so NULL.
INSERT INTO public.email_outbox (id, kind, intended_to, message, reason) VALUES
  ('a7000000-0000-4000-8000-0000000000a1', 'transactional', 'placeholder@example.test', '{}'::jsonb, 'daily_quota');
SELECT is((SELECT tenant_id FROM public.email_outbox WHERE id = 'a7000000-0000-4000-8000-0000000000a1'), NULL::uuid,
  'a row queued without a tenant keeps NULL (Stellr''s)');

INSERT INTO public.email_outbox (id, kind, intended_to, message, reason, tenant_id) VALUES
  ('a7000000-0000-4000-8000-0000000000a2', 'transactional', 'placeholder@example.test', '{}'::jsonb, 'daily_quota',
   'a7000000-0000-4000-8000-000000000005');
SELECT is((SELECT tenant_id FROM public.email_outbox WHERE id = 'a7000000-0000-4000-8000-0000000000a2'),
  'a7000000-0000-4000-8000-000000000005'::uuid, 'a row can carry its tenant');

SELECT throws_ok(
  $q$INSERT INTO public.email_outbox (kind, intended_to, message, reason, tenant_id)
     VALUES ('transactional', 'placeholder@example.test', '{}'::jsonb, 'daily_quota', 'a7000000-0000-4000-8000-0000000000ff')$q$,
  '23503', NULL, 'an unknown tenant is refused by the foreign key');

SELECT throws_ok(
  $q$DELETE FROM public.tenants WHERE id = 'a7000000-0000-4000-8000-000000000005'$q$,
  '23503', NULL, 'a tenant with queued mail cannot be deleted (ON DELETE RESTRICT)');

-- ── 3. tenant_host_map(): shape ─────────────────────────────────────────────
SELECT has_function('public', 'tenant_host_map', ARRAY[]::text[], 'tenant_host_map() exists');
SELECT is_definer('public', 'tenant_host_map', ARRAY[]::text[], 'it is SECURITY DEFINER');
SELECT ok(
  (SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.tenant_host_map()'::regprocedure),
  'its search_path is empty');
SELECT is(
  (SELECT pg_catalog.pg_get_function_result('public.tenant_host_map()'::regprocedure)),
  'TABLE(host text, tenant_id uuid)',
  'it returns host and tenant_id and nothing else');

-- ── 4. tenant_host_map(): what it returns ───────────────────────────────────
SELECT results_eq(
  $q$SELECT host, tenant_id FROM public.tenant_host_map() WHERE host LIKE 'm7-%.pgtap.test' ORDER BY host$q$,
  $q$VALUES ('m7-active.pgtap.test'::text, 'a7000000-0000-4000-8000-000000000001'::uuid),
            ('m7-stellr.pgtap.test'::text, '00000000-0000-4000-8000-000000000001'::uuid)$q$,
  'only hosts of active tenants are returned, the platform owner included');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_host_map() WHERE host IN
     ('m7-suspended.pgtap.test', 'm7-archived.pgtap.test', 'm7-prov.pgtap.test')),
  0, 'suspended, archived and provisioning tenants'' hosts drop out');
SELECT is(
  (SELECT count(*)::int FROM public.tenant_host_map()),
  (SELECT count(*)::int FROM public.tenant_domains d JOIN public.tenants t ON t.id = d.tenant_id WHERE t.status = 'active'),
  'it returns every active host, the same set the proxy''s HOST_MAP_QUERY reads');

UPDATE public.tenants SET status = 'suspended' WHERE id = 'a7000000-0000-4000-8000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM public.tenant_host_map() WHERE host = 'm7-active.pgtap.test'),
  0, 'suspending a tenant removes its host at once');

-- ── 5. Privileges (WD-1 not accepted: service_role only) ────────────────────
SELECT ok(has_function_privilege('service_role', 'public.tenant_host_map()', 'EXECUTE'),
  'service_role can execute it');
SELECT ok(NOT has_function_privilege('anon', 'public.tenant_host_map()', 'EXECUTE'),
  'anon cannot execute it (the publishable key cannot list tenant hosts)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.tenant_host_map()', 'EXECUTE'),
  'authenticated cannot execute it');

-- ── 6. As each role ─────────────────────────────────────────────────────────
-- The call runs inside a DO block under the role and records what happened in
-- a transaction-local setting, so the pgTAP calls stay on the test's own role.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'tenant_app'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', r);
      PERFORM * FROM public.tenant_host_map();
      RESET ROLE;
      PERFORM set_config('m7_test.' || r, 'called', true);
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      PERFORM set_config('m7_test.' || r, '42501', true);
    END;
  END LOOP;
END $$;
SELECT is(current_setting('m7_test.anon'), '42501', 'anon calling it is refused');
SELECT is(current_setting('m7_test.authenticated'), '42501', 'authenticated calling it is refused');
SELECT is(current_setting('m7_test.tenant_app'), '42501', 'tenant_app calling it is refused');

SELECT * FROM finish();
ROLLBACK;
