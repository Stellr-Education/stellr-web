-- pgTAP: the compatibility views for the old Duties/crew names are gone, and the
-- renamed tables they pointed at are still there (migration
-- drop_staff_compat_views; review ids staff-role.6, staff-role.P0.compat-views,
-- rel1113-drop-compat-views).
--
-- Runs in the `db` job of .github/workflows/ci.yml with the other files in this
-- directory.
BEGIN;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

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
SELECT ok(has_table_privilege('service_role', 'public.admin_duties', 'SELECT, INSERT, UPDATE, DELETE')
          AND has_table_privilege('service_role', 'public.event_crew_check_ins', 'SELECT, INSERT, UPDATE, DELETE'),
  'service_role can still read and write both renamed tables');

SELECT * FROM finish();
ROLLBACK;
