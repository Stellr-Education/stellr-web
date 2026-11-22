-- S5 programme row .32: a database-enforced "not ready for tenants" lock.
--
-- public.tenants.status defaults to 'active', so today any insert of a second tenant makes
-- it live at once, whatever the isolating switches say. This file makes the database refuse
-- that until the platform is attested ready for other tenants:
--
--   tenancy_settings.tenants_ready_at   NULL (the default): no tenant other than the platform
--                                       owner may be 'active'. Set: the owner has checked the
--                                       isolating switches (lib/tenancy/flags.ts,
--                                       ISOLATING_SWITCHES; docs/TENANCY-S5.md, "The readiness
--                                       lock") in that environment and attests them.
--   tenancy_settings.tenants_ready_note who attested, and against which check. No personal data.
--
-- Two triggers:
--   tenants        a non-owner row may not be inserted as, or moved to, 'active' while
--                  tenants_ready_at is NULL. 'provisioning', 'suspended' and 'archived' are
--                  always allowed, so a tenant can be set up before the lock opens.
--   tenancy_settings  tenants_ready_at may not go back to NULL while any non-owner tenant
--                  is 'active': suspend those first. Closing the lock never strands a live
--                  tenant without it noticing.
--
-- Both raise SQLSTATE 55000 (object_not_in_prerequisite_state). The platform owner is safe
-- from the first: only one owner can exist (tenants_one_platform_owner, a unique partial
-- index), and it is Stellr.
--
-- The lock is an attestation, not a reading of the switches: the Vercel variables are not
-- visible to the database. The admin health route reports the switches beside the lock
-- (tenancy.readiness), and records a TENANCY readiness row in app_errors whenever an active
-- non-owner tenant exists while a switch is not in its isolating state.
--
-- What this does to live data: nothing. Both databases hold one tenant, Stellr (22 Nov 2026).
-- The column is added with no default rewrite, and the triggers fire only on later writes.
-- Test fixtures that insert another tenant set tenants_ready_at inside their own rolled-back
-- transaction first. On dev, the owner sets it before K9's canary tenant goes active.
--
-- Both functions are SECURITY INVOKER with an empty search_path. Only the service role and
-- the database owner write these tables; tenant_app reads tenants and cannot write it.

ALTER TABLE public.tenancy_settings
  ADD COLUMN IF NOT EXISTS tenants_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS tenants_ready_note text
    CHECK (tenants_ready_note IS NULL OR char_length(tenants_ready_note) <= 500);

COMMENT ON COLUMN public.tenancy_settings.tenants_ready_at IS
  'S5 .32 readiness lock. NULL: no non-owner tenant may be active. Set only after the isolating switches are checked in this environment (docs/TENANCY-S5.md, "The readiness lock").';
COMMENT ON COLUMN public.tenancy_settings.tenants_ready_note IS
  'Who attested readiness and against which check. No personal data.';

CREATE OR REPLACE FUNCTION public.tenancy_refuse_unready_tenant()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
DECLARE
  ready_at timestamptz;
BEGIN
  IF NEW.status <> 'active' OR NEW.is_platform_owner THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NOT OLD.is_platform_owner THEN
    RETURN NEW;  -- already active: an edit to another column is not a new activation
  END IF;
  SELECT s.tenants_ready_at INTO ready_at FROM public.tenancy_settings s WHERE s.id;
  IF ready_at IS NULL THEN
    RAISE EXCEPTION 'tenancy: tenant % cannot be active until the platform is attested ready for tenants (tenancy_settings.tenants_ready_at)', NEW.slug
      USING ERRCODE = '55000',
            HINT = 'Insert it as provisioning, or attest readiness: docs/TENANCY-S5.md, "The readiness lock".';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tenancy_readiness_lock ON public.tenants;
CREATE TRIGGER tenancy_readiness_lock
  BEFORE INSERT OR UPDATE OF status, is_platform_owner ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_refuse_unready_tenant();

CREATE OR REPLACE FUNCTION public.tenancy_guard_readiness()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
BEGIN
  IF OLD.tenants_ready_at IS NOT NULL AND NEW.tenants_ready_at IS NULL
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.status = 'active' AND NOT t.is_platform_owner) THEN
    RAISE EXCEPTION 'tenancy: the readiness lock cannot close while another tenant is active'
      USING ERRCODE = '55000',
            HINT = 'Suspend every active non-owner tenant first.';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tenancy_readiness_guard ON public.tenancy_settings;
CREATE TRIGGER tenancy_readiness_guard
  BEFORE UPDATE OF tenants_ready_at ON public.tenancy_settings
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_guard_readiness();

REVOKE ALL ON FUNCTION public.tenancy_refuse_unready_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenancy_guard_readiness() FROM PUBLIC, anon, authenticated;
