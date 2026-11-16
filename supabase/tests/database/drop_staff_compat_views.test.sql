-- pgTAP: the compatibility views for the old Duties/crew names are gone, and the
-- renamed tables they pointed at are still there (migration
-- drop_staff_compat_views; review ids staff-role.6, staff-role.P0.compat-views,
-- rel1113-drop-compat-views).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in this
-- directory.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(15);

-- ── 1. The old names are gone, as views and as anything else ─────────────────
SELECT hasnt_view('public', 'staff_roles', 'the staff_roles compatibility view is dropped');
SELECT hasnt_view('public', 'event_staff_check_ins', 'the event_staff_check_ins compatibility view is dropped');
SELECT ok(to_regclass('public.staff_roles') IS NULL,
  'no relation of any kind is named public.staff_roles');
SELECT ok(to_regclass('public.event_staff_check_ins') IS NULL,
  'no relation of any kind is named public.event_staff_check_ins');

-- ── 2. The renamed tables are untouched ─────────────────────────────────────
SELECT has_table('public', 'admin_duties', 'admin_duties (was staff_roles) still exists');
SELECT has_table('public', 'event_crew_check_ins', 'event_crew_check_ins (was event_staff_check_ins) still exists');
SELECT has_column('public', 'event_crew_check_ins', 'crew_key',
  'event_crew_check_ins keeps its crew_key column');
-- ── 3. service_role keeps every privilege it needs, each checked on its own ──
-- has_table_privilege with a comma-separated list is true if ANY one of them is
-- held, so each privilege is asserted separately on each table.
SELECT ok(has_table_privilege('service_role', 'public.admin_duties', 'SELECT'),
  'service_role can SELECT from admin_duties');
SELECT ok(has_table_privilege('service_role', 'public.admin_duties', 'INSERT'),
  'service_role can INSERT into admin_duties');
SELECT ok(has_table_privilege('service_role', 'public.admin_duties', 'UPDATE'),
  'service_role can UPDATE admin_duties');
SELECT ok(has_table_privilege('service_role', 'public.admin_duties', 'DELETE'),
  'service_role can DELETE from admin_duties');
SELECT ok(has_table_privilege('service_role', 'public.event_crew_check_ins', 'SELECT'),
  'service_role can SELECT from event_crew_check_ins');
SELECT ok(has_table_privilege('service_role', 'public.event_crew_check_ins', 'INSERT'),
  'service_role can INSERT into event_crew_check_ins');
SELECT ok(has_table_privilege('service_role', 'public.event_crew_check_ins', 'UPDATE'),
  'service_role can UPDATE event_crew_check_ins');
SELECT ok(has_table_privilege('service_role', 'public.event_crew_check_ins', 'DELETE'),
  'service_role can DELETE from event_crew_check_ins');

SELECT * FROM finish();
ROLLBACK;
