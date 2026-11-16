-- Drop the compatibility views the Duties/crew rename kept for one release
-- (review ids staff-role.6, staff-role.P0.compat-views, rel1113-drop-compat-views).
--
-- 20261113120000_rename_staff_to_duties_and_crew.sql renamed staff_roles to
-- admin_duties and event_staff_check_ins to event_crew_check_ins, and left a view
-- under each old name so the code then in production kept working through the
-- deploy gap and for one release after. That rename reached production with
-- #680 (fba19669, 14 Nov 2026), and no code, test, seed, script or SQL function
-- reads the old names now.
--
-- Nothing depends on the views: no other view, rule, function body, policy or
-- trigger in the migrations names them, so a plain DROP (no CASCADE) is enough.
-- If something unexpected did depend on one, the DROP fails and the migration
-- rolls back, which is the safe outcome.
--
-- No data changes: the rows live in admin_duties and event_crew_check_ins, which
-- this migration does not touch. DROP VIEW takes an ACCESS EXCLUSIVE lock on the
-- view only, for an instant.

SET lock_timeout = '5s';

DROP VIEW IF EXISTS public.staff_roles;
DROP VIEW IF EXISTS public.event_staff_check_ins;

NOTIFY pgrst, 'reload schema';
