-- S6-CON-b (docs/PLAN-S6-DRAFT.md, slice row 7): per-tenant errors and per-tenant
-- feature flags for the super-admin console.
--
-- What it adds:
--
--   1. public.app_errors.tenant_id: the tenant a captured error's request served, NULL
--      for a Stellr host (the platform owner's own traffic). lib/app-errors.ts reads it
--      from the header the proxy sets on tenant hosts only, folds it into the digest
--      only when present (so every existing Stellr digest is unchanged), and passes it
--      to record_app_error. An id that is no tenant is stored as NULL rather than
--      failing the write: error capture must never fail.
--
--   2. record_app_error gains p_tenant_id uuid DEFAULT NULL. The four-argument form is
--      replaced, not overloaded: a caller naming the first four arguments (production
--      code before this release) resolves to the new form with tenant NULL, so the
--      migration can run before the code. Still SECURITY INVOKER, service_role only.
--
--   3. public.tenant_feature_flags: one row per tenant and flag that differs from the
--      flag's default (lib/tenancy/tenant-flags.ts holds the defaults and meanings).
--      The flag names are a fixed CHECK list, so a typo cannot create a flag nobody
--      reads. RLS on, service_role only; the platform owner is refused (Stellr's own
--      behaviour is not a tenant switch). The first flag, break_glass_allowed, lets a
--      tenant be closed to break-glass requests (app/api/admin/support/consent).
--
-- What this does to live data: a nullable column (NULL for every existing row), a
-- replaced function that behaves as before when called as before, and a new empty table.

-- ── 1. app_errors.tenant_id ─────────────────────────────────────────────────

ALTER TABLE public.app_errors
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);

CREATE INDEX IF NOT EXISTS app_errors_tenant_last_seen_idx
  ON public.app_errors (tenant_id, last_seen DESC) WHERE tenant_id IS NOT NULL;

COMMENT ON COLUMN public.app_errors.tenant_id IS
  'S6-CON-b: the tenant host the error''s request served (x-stellr-tenant-id), NULL for a Stellr host. Read by the super-admin console per tenant.';

-- ── 2. record_app_error(…, p_tenant_id) ─────────────────────────────────────

DROP FUNCTION IF EXISTS public.record_app_error(text, text, text, int);

CREATE OR REPLACE FUNCTION public.record_app_error(
  p_digest text,
  p_route text,
  p_message text,
  p_count int DEFAULT 1,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_tenant uuid := NULL;
BEGIN
  IF p_tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id) THEN
    v_tenant := p_tenant_id;
  END IF;
  INSERT INTO public.app_errors (digest, route, message, count, tenant_id)
    VALUES (p_digest, left(p_route, 300), left(p_message, 1000), greatest(p_count, 1), v_tenant)
    ON CONFLICT (digest) DO UPDATE
      SET count = app_errors.count + greatest(p_count, 1),
          last_seen = now();
END $$;

REVOKE EXECUTE ON FUNCTION public.record_app_error(text, text, text, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_error(text, text, text, int, uuid) TO service_role;

-- ── 3. tenant_feature_flags ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_feature_flags (
  tenant_id  uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  flag       text NOT NULL CHECK (flag IN ('break_glass_allowed')),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text CHECK (updated_by IS NULL OR char_length(updated_by) BETWEEN 1 AND 100),
  PRIMARY KEY (tenant_id, flag)
);

COMMENT ON TABLE public.tenant_feature_flags IS
  'S6-CON-b: per-tenant switches set from the super-admin console. A missing row means the flag''s default (lib/tenancy/tenant-flags.ts). service_role only; never the platform owner.';

ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_feature_flags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_feature_flags TO service_role;
DROP POLICY IF EXISTS "service role full access tenant_feature_flags" ON public.tenant_feature_flags;
CREATE POLICY "service role full access tenant_feature_flags"
  ON public.tenant_feature_flags FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tenant_feature_flags_refuse_owner()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.is_platform_owner) THEN
    RAISE EXCEPTION 'tenant_feature_flags: the platform owner has no tenant switches'
      USING ERRCODE = '23514',
            HINT = 'Stellr''s own behaviour is set in code and env, not per tenant (docs/PLAN-S6-DRAFT.md, S6-CON).';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_feature_flags_refuse_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenant_feature_flags_refuse_owner ON public.tenant_feature_flags;
CREATE TRIGGER tenant_feature_flags_refuse_owner
  BEFORE INSERT OR UPDATE OF tenant_id ON public.tenant_feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.tenant_feature_flags_refuse_owner();
