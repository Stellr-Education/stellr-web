-- S6-SUP (docs/S6-DESIGN.md, section 2; docs/PLAN-S6-DRAFT.md, slice row 4): support
-- sessions and the read-only support role.
--
-- Support mode lets a platform admin look into ONE non-owner tenant, read-only, for at
-- most 60 minutes, with a reason, and every open and close lands on that tenant's audit
-- chain (platform_audit_events). The app side is behind SUPPORT_MODE_ENABLED, off
-- everywhere (lib/authz/support-session.ts). Both databases hold one tenant, Stellr, the
-- platform owner, and a session for the owner is refused, so nothing here can be used yet.
--
-- What it adds:
--
--   1. public.support_sessions: one row per session. service_role only: RLS on, no
--      grant to anon, authenticated, tenant_app or tenant_support_ro. The admin is a
--      platform_admins row (ON DELETE CASCADE: removing a platform admin ends their
--      sessions, since the app refuses a session with no row). Checks: reason of 20 to
--      500 characters, mode 'read' or 'break_glass' (S6-BG; the app opens only 'read'),
--      ends_at after opened_at and no more than 60 minutes after it, closed_at not
--      before opened_at. A trigger refuses a session for the platform-owner tenant:
--      Stellr's staff use the ordinary admin screens (S6-DESIGN, "What support mode
--      never does"). The free-text reason stays here and never goes on the audit chain,
--      which can never be erased (lib/audit/platform.ts cleanReason).
--
--   2. tenant_support_ro: NOLOGIN NOINHERIT NOBYPASSRLS, like tenant_app. It holds
--      SELECT, and nothing else, on exactly the tables tenant_app can read (the 52
--      own, derived and inherited tenant tables in lib/tenancy/registry.ts, and
--      public.tenants), under its OWN policies keyed on the same transaction-local
--      setting (public.app_tenant_id(), docs/S4-SPIKE.md Option B):
--
--        support_read        PERMISSIVE FOR SELECT  USING (tenant_id = app_tenant_id())
--        support_read_guard  RESTRICTIVE FOR ALL    USING (same)  WITH CHECK (false)
--
--      Why its own policies and not a membership or an edit of tenant_app's: granting
--      tenant_app to it (or it to tenant_app) would carry tenant_app's INSERT, UPDATE
--      and DELETE; adding it to tenant_app's FOR ALL policies would tie the two roles'
--      reach together, so a later tenant_app policy change would silently widen
--      support. Separate, explicit, SELECT-only policies keep the support role's reach
--      readable in one place. The restrictive guard caps it at the pinned tenant
--      whatever permissive policy anyone later writes for PUBLIC, and its WITH CHECK
--      (false) refuses any write even if a table privilege were ever granted.
--      pgTAP (supabase/tests/database/support_sessions.test.sql) holds the two roles'
--      readable tables equal and the USING expressions identical, so drift fails CI.
--
--      No INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER anywhere, no
--      sequence, no storage policy, and EXECUTE only on public.app_tenant_id() (which
--      writes nothing). lib/tenancy/db.ts also opens every support transaction READ
--      ONLY, so the database refuses a write a function might attempt.
--
--   3. The tenant login (tenant_app_login, which the owner creates by hand:
--      docs/TENANCY-S5-data.md, "Owner steps") may SET ROLE to it, as it does to
--      tenant_app. Granted here only when that login already exists; otherwise it is
--      the owner's one extra line, `GRANT tenant_support_ro TO tenant_app_login;`.
--      The login stays NOINHERIT, so membership confers nothing until SET ROLE.
--
-- What this does to live data: nothing. A new empty table, a new role nobody can log in
-- as, and SELECT policies that apply only to that role. Every live query runs as
-- service_role (BYPASSRLS) or authenticated, which these policies do not name.

-- ── 1. support_sessions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_user_id text NOT NULL
                           REFERENCES public.platform_admins (clerk_user_id) ON DELETE CASCADE,
  tenant_id              uuid NOT NULL REFERENCES public.tenants (id),
  reason                 text NOT NULL CHECK (char_length(reason) BETWEEN 20 AND 500),
  mode                   text NOT NULL DEFAULT 'read' CHECK (mode IN ('read', 'break_glass')),
  opened_at              timestamptz NOT NULL DEFAULT now(),
  ends_at                timestamptz NOT NULL,
  closed_at              timestamptz,
  CONSTRAINT support_sessions_window_check
    CHECK (ends_at > opened_at AND ends_at <= opened_at + interval '60 minutes'),
  CONSTRAINT support_sessions_closed_check
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

COMMENT ON TABLE public.support_sessions IS
  'S6-SUP support sessions: a platform admin reading one non-owner tenant, read-only, for 60 minutes or less. service_role only. Opening and closing are audited on the tenant''s chain (platform_audit_events). docs/S6-DESIGN.md section 2.';

CREATE INDEX IF NOT EXISTS support_sessions_tenant_idx
  ON public.support_sessions (tenant_id, opened_at);
CREATE INDEX IF NOT EXISTS support_sessions_open_idx
  ON public.support_sessions (platform_admin_user_id) WHERE closed_at IS NULL;

ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_sessions TO service_role;
DROP POLICY IF EXISTS "service role full access support_sessions" ON public.support_sessions;
CREATE POLICY "service role full access support_sessions"
  ON public.support_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- A session for the platform owner is refused: support mode never reaches Stellr's own
-- data. A missing tenant is the foreign key's to refuse. SECURITY INVOKER, empty
-- search_path; only service_role and the database owner write this table.
CREATE OR REPLACE FUNCTION public.support_sessions_refuse_owner()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.is_platform_owner) THEN
    RAISE EXCEPTION 'support_sessions: no support session for the platform-owner tenant'
      USING ERRCODE = '23514',
            HINT = 'Support mode is for other tenants only (docs/S6-DESIGN.md, S6-Q7 and section 2).';
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.support_sessions_refuse_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS support_sessions_refuse_owner ON public.support_sessions;
CREATE TRIGGER support_sessions_refuse_owner
  BEFORE INSERT OR UPDATE OF tenant_id ON public.support_sessions
  FOR EACH ROW EXECUTE FUNCTION public.support_sessions_refuse_owner();

-- ── 2. tenant_support_ro ────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'tenant_support_ro') THEN
    CREATE ROLE tenant_support_ro NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  -- A role of this name that already exists must not be able to escape RLS or log in.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'tenant_support_ro'
      AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'tenant_support_ro exists with an attribute that escapes RLS or logs in; refusing to grant it tenant data';
  END IF;
END $$;

COMMENT ON ROLE tenant_support_ro IS
  'S6-SUP support role: SELECT only, on the tables tenant_app reads, under its own policies pinned by public.app_tenant_id(). No BYPASSRLS, no write anywhere. Used only through lib/tenancy/support-db.ts.';

GRANT USAGE ON SCHEMA public TO tenant_support_ro;
GRANT EXECUTE ON FUNCTION public.app_tenant_id() TO tenant_support_ro;

-- public.tenants: its own row only, read-only (as tenant_self for tenant_app).
GRANT SELECT ON public.tenants TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.tenants;
CREATE POLICY support_read ON public.tenants AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.tenants;
CREATE POLICY support_read_guard ON public.tenants AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

-- The 52 tenant tables, alphabetical, from lib/tenancy/registry.ts ('own', 'derived'
-- and 'inherited'). A table added later that tenant_app reads adds its block here too:
-- support_sessions.test.sql fails until it does.

GRANT SELECT ON public.addon_orders TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.addon_orders;
CREATE POLICY support_read ON public.addon_orders AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.addon_orders;
CREATE POLICY support_read_guard ON public.addon_orders AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.agreement_email_changes TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.agreement_email_changes;
CREATE POLICY support_read ON public.agreement_email_changes AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.agreement_email_changes;
CREATE POLICY support_read_guard ON public.agreement_email_changes AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.agreement_recipients TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.agreement_recipients;
CREATE POLICY support_read ON public.agreement_recipients AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.agreement_recipients;
CREATE POLICY support_read_guard ON public.agreement_recipients AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.agreements TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.agreements;
CREATE POLICY support_read ON public.agreements AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.agreements;
CREATE POLICY support_read_guard ON public.agreements AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.community_resources TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.community_resources;
CREATE POLICY support_read ON public.community_resources AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.community_resources;
CREATE POLICY support_read_guard ON public.community_resources AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.community_spaces TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.community_spaces;
CREATE POLICY support_read ON public.community_spaces AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.community_spaces;
CREATE POLICY support_read_guard ON public.community_spaces AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.credential_events TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.credential_events;
CREATE POLICY support_read ON public.credential_events AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.credential_events;
CREATE POLICY support_read_guard ON public.credential_events AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.credentials TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.credentials;
CREATE POLICY support_read ON public.credentials AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.credentials;
CREATE POLICY support_read_guard ON public.credentials AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.esign_access_log TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.esign_access_log;
CREATE POLICY support_read ON public.esign_access_log AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.esign_access_log;
CREATE POLICY support_read_guard ON public.esign_access_log AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.esign_audit_events TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.esign_audit_events;
CREATE POLICY support_read ON public.esign_audit_events AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.esign_audit_events;
CREATE POLICY support_read_guard ON public.esign_audit_events AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_addon_settings TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_addon_settings;
CREATE POLICY support_read ON public.event_addon_settings AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_addon_settings;
CREATE POLICY support_read_guard ON public.event_addon_settings AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_addons TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_addons;
CREATE POLICY support_read ON public.event_addons AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_addons;
CREATE POLICY support_read_guard ON public.event_addons AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_award_assignments TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_award_assignments;
CREATE POLICY support_read ON public.event_award_assignments AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_award_assignments;
CREATE POLICY support_read_guard ON public.event_award_assignments AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_badge_templates TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_badge_templates;
CREATE POLICY support_read ON public.event_badge_templates AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_badge_templates;
CREATE POLICY support_read_guard ON public.event_badge_templates AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_certificate_templates TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_certificate_templates;
CREATE POLICY support_read ON public.event_certificate_templates AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_certificate_templates;
CREATE POLICY support_read_guard ON public.event_certificate_templates AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_companies TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_companies;
CREATE POLICY support_read ON public.event_companies AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_companies;
CREATE POLICY support_read_guard ON public.event_companies AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_crew_check_ins TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_crew_check_ins;
CREATE POLICY support_read ON public.event_crew_check_ins AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_crew_check_ins;
CREATE POLICY support_read_guard ON public.event_crew_check_ins AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_email_sends TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_email_sends;
CREATE POLICY support_read ON public.event_email_sends AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_email_sends;
CREATE POLICY support_read_guard ON public.event_email_sends AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_email_templates TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_email_templates;
CREATE POLICY support_read ON public.event_email_templates AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_email_templates;
CREATE POLICY support_read_guard ON public.event_email_templates AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_emails TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_emails;
CREATE POLICY support_read ON public.event_emails AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_emails;
CREATE POLICY support_read_guard ON public.event_emails AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_manager_assignments TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_manager_assignments;
CREATE POLICY support_read ON public.event_manager_assignments AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_manager_assignments;
CREATE POLICY support_read_guard ON public.event_manager_assignments AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_participations TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_participations;
CREATE POLICY support_read ON public.event_participations AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_participations;
CREATE POLICY support_read_guard ON public.event_participations AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_refunds TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_refunds;
CREATE POLICY support_read ON public.event_refunds AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_refunds;
CREATE POLICY support_read_guard ON public.event_refunds AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_settings TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_settings;
CREATE POLICY support_read ON public.event_settings AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_settings;
CREATE POLICY support_read_guard ON public.event_settings AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.event_store_offerings TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.event_store_offerings;
CREATE POLICY support_read ON public.event_store_offerings AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.event_store_offerings;
CREATE POLICY support_read_guard ON public.event_store_offerings AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.events TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.events;
CREATE POLICY support_read ON public.events AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.events;
CREATE POLICY support_read_guard ON public.events AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.group_invoices TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.group_invoices;
CREATE POLICY support_read ON public.group_invoices AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.group_invoices;
CREATE POLICY support_read_guard ON public.group_invoices AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.group_join_tokens TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.group_join_tokens;
CREATE POLICY support_read ON public.group_join_tokens AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.group_join_tokens;
CREATE POLICY support_read_guard ON public.group_join_tokens AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.member_group_members TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.member_group_members;
CREATE POLICY support_read ON public.member_group_members AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.member_group_members;
CREATE POLICY support_read_guard ON public.member_group_members AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.member_groups TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.member_groups;
CREATE POLICY support_read ON public.member_groups AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.member_groups;
CREATE POLICY support_read_guard ON public.member_groups AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.mentoring_cohorts TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.mentoring_cohorts;
CREATE POLICY support_read ON public.mentoring_cohorts AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.mentoring_cohorts;
CREATE POLICY support_read_guard ON public.mentoring_cohorts AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.merch_batches TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.merch_batches;
CREATE POLICY support_read ON public.merch_batches AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.merch_batches;
CREATE POLICY support_read_guard ON public.merch_batches AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.participants TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.participants;
CREATE POLICY support_read ON public.participants AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.participants;
CREATE POLICY support_read_guard ON public.participants AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.refund_policies TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.refund_policies;
CREATE POLICY support_read ON public.refund_policies AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.refund_policies;
CREATE POLICY support_read_guard ON public.refund_policies AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.registration_addons TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.registration_addons;
CREATE POLICY support_read ON public.registration_addons AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.registration_addons;
CREATE POLICY support_read_guard ON public.registration_addons AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.registrations TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.registrations;
CREATE POLICY support_read ON public.registrations AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.registrations;
CREATE POLICY support_read_guard ON public.registrations AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.scholarship_applications TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.scholarship_applications;
CREATE POLICY support_read ON public.scholarship_applications AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.scholarship_applications;
CREATE POLICY support_read_guard ON public.scholarship_applications AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.store_event_discounts TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.store_event_discounts;
CREATE POLICY support_read ON public.store_event_discounts AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.store_event_discounts;
CREATE POLICY support_read_guard ON public.store_event_discounts AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.store_order_items TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.store_order_items;
CREATE POLICY support_read ON public.store_order_items AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.store_order_items;
CREATE POLICY support_read_guard ON public.store_order_items AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.store_orders TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.store_orders;
CREATE POLICY support_read ON public.store_orders AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.store_orders;
CREATE POLICY support_read_guard ON public.store_orders AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.store_returns TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.store_returns;
CREATE POLICY support_read ON public.store_returns AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.store_returns;
CREATE POLICY support_read_guard ON public.store_returns AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.survey_access_log TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.survey_access_log;
CREATE POLICY support_read ON public.survey_access_log AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.survey_access_log;
CREATE POLICY support_read_guard ON public.survey_access_log AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.survey_answers TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.survey_answers;
CREATE POLICY support_read ON public.survey_answers AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.survey_answers;
CREATE POLICY support_read_guard ON public.survey_answers AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.survey_distributions TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.survey_distributions;
CREATE POLICY support_read ON public.survey_distributions AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.survey_distributions;
CREATE POLICY support_read_guard ON public.survey_distributions AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.survey_invitations TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.survey_invitations;
CREATE POLICY support_read ON public.survey_invitations AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.survey_invitations;
CREATE POLICY support_read_guard ON public.survey_invitations AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.survey_responses TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.survey_responses;
CREATE POLICY support_read ON public.survey_responses AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.survey_responses;
CREATE POLICY support_read_guard ON public.survey_responses AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.team_profiles TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.team_profiles;
CREATE POLICY support_read ON public.team_profiles AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.team_profiles;
CREATE POLICY support_read_guard ON public.team_profiles AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.tenant_domains TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.tenant_domains;
CREATE POLICY support_read ON public.tenant_domains AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.tenant_domains;
CREATE POLICY support_read_guard ON public.tenant_domains AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.tenant_memberships TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.tenant_memberships;
CREATE POLICY support_read ON public.tenant_memberships AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.tenant_memberships;
CREATE POLICY support_read_guard ON public.tenant_memberships AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.training_assignments TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.training_assignments;
CREATE POLICY support_read ON public.training_assignments AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.training_assignments;
CREATE POLICY support_read_guard ON public.training_assignments AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.training_modules TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.training_modules;
CREATE POLICY support_read ON public.training_modules AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.training_modules;
CREATE POLICY support_read_guard ON public.training_modules AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

GRANT SELECT ON public.volunteer_event_interest TO tenant_support_ro;
DROP POLICY IF EXISTS support_read ON public.volunteer_event_interest;
CREATE POLICY support_read ON public.volunteer_event_interest AS PERMISSIVE FOR SELECT TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS support_read_guard ON public.volunteer_event_interest;
CREATE POLICY support_read_guard ON public.volunteer_event_interest AS RESTRICTIVE FOR ALL TO tenant_support_ro
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (false);

-- ── 3. The tenant login may become it ───────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'tenant_app_login') THEN
    EXECUTE format('GRANT %I TO %I', 'tenant_support_ro', 'tenant_app_login');
  END IF;
END $$;
