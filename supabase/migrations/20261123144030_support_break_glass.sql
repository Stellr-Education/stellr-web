-- S6-BG (docs/S6-DESIGN.md, section 3; docs/PLAN-S6-DRAFT.md, slice row 5): break-glass.
--
-- Break-glass is a support session in write mode, for one task, with the tenant's
-- consent. The app side is behind SUPPORT_MODE_ENABLED, off everywhere, and both
-- databases hold one tenant, Stellr, the platform owner, for which every support row is
-- refused. So nothing here can be used yet.
--
-- What it adds:
--
--   1. public.support_consents: a platform admin's request to break glass on one
--      tenant, and that tenant's answer. service_role only. Checks: a reason of 20 to
--      500 characters; it lapses within 24 hours of the request; at most one of
--      approved, declined; a decision names who made it; used only once approved. A
--      trigger refuses a request for the platform-owner tenant.
--
--   2. support_sessions gains consent_id (a break_glass session names exactly one
--      consent, and a consent opens at most one session), renewed_at and
--      renewal_reason (only a break_glass session renews, and only with a reason).
--      The existing 60-minute window check caps a renewed session: 30 minutes, then
--      at most 30 more (S6-Q5).
--
--   3. Four functions, SECURITY INVOKER, service_role only, each one atomic, so the
--      refusals the S6 gate names live in the database and pgTAP tests them:
--
--        support_consent_decide(consent, tenant, approver, approve)
--          The request must be the named tenant's (the app passes the host's tenant).
--          Only a tenant_admin membership (by Clerk user id) of THAT tenant decides.
--          Refused for the requesting admin, for any platform admin (the platform
--          cannot consent on a tenant's behalf: S6-Q4), and for a consent that is
--          decided, withdrawn or lapsed.
--        support_break_glass_open(consent, admin, reason)
--          Refused without an approved, unused, unlapsed, unwithdrawn consent from
--          that admin's own request (break_glass_no_consent), without a reason of 20
--          characters (break_glass_reason), and while the admin has a live session
--          (support_session_open). Opens a 30-minute break_glass session and spends
--          the consent, in one transaction.
--        support_break_glass_renew(session, admin, reason)
--          Once only (break_glass_renewed), with a fresh reason, on the admin's own
--          live break_glass session (break_glass_ended otherwise).
--        support_consent_withdraw(consent, tenant)
--          Withdraws an unused request (the app's undo when an approval cannot be
--          recorded on the audit chain).
--
--      Each refusal carries its code in HINT; lib/support/break-glass.ts maps it to the
--      answer. The step-up refusal is the app's (Clerk), and the time limit is also
--      checked on every admin request (lib/authz/writable.ts).
--
-- What this does to live data: nothing. A new empty table, three nullable columns on an
-- empty table, and functions nothing calls while the flag is off.

-- ── 1. support_consents ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_consents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES public.tenants (id),
  platform_admin_user_id   text NOT NULL
                             REFERENCES public.platform_admins (clerk_user_id) ON DELETE CASCADE,
  reason                   text NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 500),
  requested_at             timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL,
  approved_at              timestamptz,
  declined_at              timestamptz,
  decided_by_clerk_user_id text CHECK (decided_by_clerk_user_id IS NULL OR char_length(decided_by_clerk_user_id) BETWEEN 1 AND 100),
  withdrawn_at             timestamptz,
  used_at                  timestamptz,
  CONSTRAINT support_consents_window_check
    CHECK (expires_at > requested_at AND expires_at <= requested_at + interval '24 hours'),
  CONSTRAINT support_consents_one_decision_check
    CHECK (approved_at IS NULL OR declined_at IS NULL),
  CONSTRAINT support_consents_decider_check
    CHECK ((approved_at IS NULL AND declined_at IS NULL) = (decided_by_clerk_user_id IS NULL)),
  CONSTRAINT support_consents_used_check
    CHECK (used_at IS NULL OR approved_at IS NOT NULL)
);

COMMENT ON TABLE public.support_consents IS
  'S6-BG: a platform admin''s request to break glass on one non-owner tenant, and the tenant admin''s answer. Single use, lapses within 24 hours. service_role only. docs/S6-DESIGN.md section 3.';

CREATE INDEX IF NOT EXISTS support_consents_tenant_idx
  ON public.support_consents (tenant_id, requested_at);
CREATE INDEX IF NOT EXISTS support_consents_admin_idx
  ON public.support_consents (platform_admin_user_id);

ALTER TABLE public.support_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_consents TO service_role;
DROP POLICY IF EXISTS "service role full access support_consents" ON public.support_consents;
CREATE POLICY "service role full access support_consents"
  ON public.support_consents FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.support_consents_refuse_owner()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.is_platform_owner) THEN
    RAISE EXCEPTION 'support_consents: no break-glass for the platform-owner tenant'
      USING ERRCODE = '23514',
            HINT = 'Support mode is for other tenants only (docs/S6-DESIGN.md, section 3).';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.support_consents_refuse_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS support_consents_refuse_owner ON public.support_consents;
CREATE TRIGGER support_consents_refuse_owner
  BEFORE INSERT OR UPDATE OF tenant_id ON public.support_consents
  FOR EACH ROW EXECUTE FUNCTION public.support_consents_refuse_owner();

-- ── 2. support_sessions: consent and renewal ────────────────────────────────

ALTER TABLE public.support_sessions
  ADD COLUMN IF NOT EXISTS consent_id     uuid REFERENCES public.support_consents (id),
  ADD COLUMN IF NOT EXISTS renewed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_reason text;

ALTER TABLE public.support_sessions DROP CONSTRAINT IF EXISTS support_sessions_consent_check;
ALTER TABLE public.support_sessions ADD CONSTRAINT support_sessions_consent_check
  CHECK ((mode = 'break_glass') = (consent_id IS NOT NULL));
ALTER TABLE public.support_sessions DROP CONSTRAINT IF EXISTS support_sessions_renewal_check;
ALTER TABLE public.support_sessions ADD CONSTRAINT support_sessions_renewal_check
  CHECK (
    (renewed_at IS NULL) = (renewal_reason IS NULL)
    AND (renewed_at IS NULL OR mode = 'break_glass')
    AND (renewal_reason IS NULL OR char_length(renewal_reason) BETWEEN 20 AND 500)
  );

CREATE UNIQUE INDEX IF NOT EXISTS support_sessions_consent_unique
  ON public.support_sessions (consent_id) WHERE consent_id IS NOT NULL;

-- ── 3. The functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.support_consent_decide(p_consent_id uuid, p_tenant_id uuid, p_approver text, p_approve boolean)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
DECLARE
  c public.support_consents%ROWTYPE;
  now_ts timestamptz := pg_catalog.now();
BEGIN
  SELECT * INTO c FROM public.support_consents AS sc WHERE sc.id = p_consent_id FOR UPDATE;
  -- Another tenant's request is answered as if it did not exist.
  IF NOT FOUND OR c.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'no such break-glass request' USING ERRCODE = 'P0002', HINT = 'consent_not_found';
  END IF;
  IF p_approver IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships m
     WHERE m.tenant_id = c.tenant_id AND m.clerk_user_id = p_approver AND m.role = 'tenant_admin'
  ) THEN
    RAISE EXCEPTION 'only an admin of this tenant can answer a break-glass request' USING ERRCODE = '42501', HINT = 'consent_not_tenant_admin';
  END IF;
  IF p_approver = c.platform_admin_user_id
     OR EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.clerk_user_id = p_approver) THEN
    RAISE EXCEPTION 'a platform admin cannot answer a break-glass request' USING ERRCODE = '42501', HINT = 'consent_platform_admin';
  END IF;
  IF c.approved_at IS NOT NULL OR c.declined_at IS NOT NULL THEN
    RAISE EXCEPTION 'this break-glass request has already been answered' USING ERRCODE = '55000', HINT = 'consent_decided';
  END IF;
  IF c.withdrawn_at IS NOT NULL OR c.expires_at <= now_ts THEN
    RAISE EXCEPTION 'this break-glass request has lapsed' USING ERRCODE = '55000', HINT = 'consent_lapsed';
  END IF;
  UPDATE public.support_consents AS sc
     SET approved_at = CASE WHEN p_approve THEN now_ts END,
         declined_at = CASE WHEN p_approve THEN NULL ELSE now_ts END,
         decided_by_clerk_user_id = p_approver
   WHERE sc.id = c.id;
  RETURN c.tenant_id;
END
$$;

CREATE OR REPLACE FUNCTION public.support_break_glass_open(p_consent_id uuid, p_admin text, p_reason text)
  RETURNS TABLE (session_id uuid, tenant_id uuid, ends_at timestamptz)
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
DECLARE
  c public.support_consents%ROWTYPE;
  now_ts timestamptz := pg_catalog.now();
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  s_id uuid;
  s_end timestamptz;
BEGIN
  IF char_length(v_reason) < 20 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'break-glass needs a reason of 20 to 500 characters' USING ERRCODE = '22023', HINT = 'break_glass_reason';
  END IF;
  SELECT * INTO c FROM public.support_consents AS sc WHERE sc.id = p_consent_id FOR UPDATE;
  IF NOT FOUND
     OR c.platform_admin_user_id IS DISTINCT FROM p_admin
     OR c.approved_at IS NULL
     OR c.declined_at IS NOT NULL
     OR c.withdrawn_at IS NOT NULL
     OR c.used_at IS NOT NULL
     OR c.expires_at <= now_ts THEN
    RAISE EXCEPTION 'no approved, unused consent from this tenant' USING ERRCODE = '42501', HINT = 'break_glass_no_consent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.support_sessions AS ss
     WHERE ss.platform_admin_user_id = p_admin AND ss.closed_at IS NULL AND ss.ends_at > now_ts
  ) THEN
    RAISE EXCEPTION 'close the current support session first' USING ERRCODE = '55000', HINT = 'support_session_open';
  END IF;
  s_end := now_ts + interval '30 minutes';
  INSERT INTO public.support_sessions AS ss (platform_admin_user_id, tenant_id, reason, mode, opened_at, ends_at, consent_id)
  VALUES (p_admin, c.tenant_id, v_reason, 'break_glass', now_ts, s_end, c.id)
  RETURNING ss.id INTO s_id;
  UPDATE public.support_consents AS sc SET used_at = now_ts WHERE sc.id = c.id;
  RETURN QUERY SELECT s_id, c.tenant_id, s_end;
END
$$;

CREATE OR REPLACE FUNCTION public.support_break_glass_renew(p_session_id uuid, p_admin text, p_reason text)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
DECLARE
  s public.support_sessions%ROWTYPE;
  now_ts timestamptz := pg_catalog.now();
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  new_end timestamptz;
BEGIN
  SELECT * INTO s FROM public.support_sessions AS ss WHERE ss.id = p_session_id FOR UPDATE;
  IF NOT FOUND
     OR s.platform_admin_user_id IS DISTINCT FROM p_admin
     OR s.mode <> 'break_glass'
     OR s.closed_at IS NOT NULL
     OR s.ends_at <= now_ts THEN
    RAISE EXCEPTION 'no live break-glass session to renew' USING ERRCODE = '55000', HINT = 'break_glass_ended';
  END IF;
  IF s.renewed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a break-glass session renews once' USING ERRCODE = '55000', HINT = 'break_glass_renewed';
  END IF;
  IF char_length(v_reason) < 20 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'a renewal needs a fresh reason of 20 to 500 characters' USING ERRCODE = '22023', HINT = 'break_glass_reason';
  END IF;
  new_end := LEAST(s.ends_at + interval '30 minutes', s.opened_at + interval '60 minutes');
  UPDATE public.support_sessions AS ss
     SET ends_at = new_end, renewed_at = now_ts, renewal_reason = v_reason
   WHERE ss.id = s.id;
  RETURN new_end;
END
$$;

CREATE OR REPLACE FUNCTION public.support_consent_withdraw(p_consent_id uuid, p_tenant_id uuid)
  RETURNS boolean
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path = ''
AS $$
  -- Withdraws an unused request of that tenant. True when a row changed.
  WITH w AS (
    UPDATE public.support_consents AS sc
       SET withdrawn_at = pg_catalog.now()
     WHERE sc.id = p_consent_id AND sc.tenant_id = p_tenant_id AND sc.used_at IS NULL AND sc.withdrawn_at IS NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM w);
$$;

REVOKE ALL ON FUNCTION public.support_consent_decide(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_break_glass_open(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_break_glass_renew(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_consent_decide(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.support_break_glass_open(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.support_break_glass_renew(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.support_consent_withdraw(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_consent_withdraw(uuid, uuid) TO service_role;
