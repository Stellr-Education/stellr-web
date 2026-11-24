-- Email plan Workstream E, as re-scoped by the owner on 23 Nov 2026: tenants send
-- no marketing (promotional mail is Stellr-only, PR B), so E guards their BULK
-- mail (event-email blasts) and watches every tenant's reputation instead.
--
--   1. tenant_email_settings: the marketing_* columns become bulk_* (a cap on a
--      tenant's event-email blasts per day and per billing month, and a manual
--      pause), plus reputation_alerted_at so the daily check alerts staff once a
--      week per tenant, not every day.
--   2. email_tenant_bulk_sends: blast sends per tenant per UTC day, bumped by
--      bump_tenant_bulk_sends after each run (lib/email/tenant-bulk.ts).
--   3. tenant_email_reputation(p_since): per tenant, since p_since, how many
--      messages were delivered or bounced, how many bounced permanently, and
--      how many drew a complaint (from email_events; lib/email/reputation.ts).
--
-- All service_role only. What this does to live data: renames three columns of a
-- table that is not in production yet, adds one nullable column, one empty
-- table and two functions.

ALTER TABLE public.tenant_email_settings RENAME COLUMN marketing_daily_cap TO bulk_daily_cap;
ALTER TABLE public.tenant_email_settings RENAME COLUMN marketing_monthly_cap TO bulk_monthly_cap;
ALTER TABLE public.tenant_email_settings RENAME COLUMN marketing_paused_at TO bulk_paused_at;
ALTER TABLE public.tenant_email_settings ADD COLUMN IF NOT EXISTS reputation_alerted_at timestamptz;

COMMENT ON COLUMN public.tenant_email_settings.bulk_daily_cap IS
  'Email plan E: most event-email blast sends a day for this tenant; NULL = no cap. Transactional mail to one person is never capped.';
COMMENT ON COLUMN public.tenant_email_settings.bulk_paused_at IS
  'Email plan E: set by a platform admin to stop this tenant''s event-email blasts; NULL = not paused.';

CREATE TABLE IF NOT EXISTS public.email_tenant_bulk_sends (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  day       date NOT NULL,
  sent      integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  PRIMARY KEY (tenant_id, day)
);

COMMENT ON TABLE public.email_tenant_bulk_sends IS
  'Email plan E: event-email blast sends per tenant per UTC day, for the per-tenant bulk caps. service_role only.';

ALTER TABLE public.email_tenant_bulk_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_tenant_bulk_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_tenant_bulk_sends TO service_role;
DROP POLICY IF EXISTS "service role full access email_tenant_bulk_sends" ON public.email_tenant_bulk_sends;
CREATE POLICY "service role full access email_tenant_bulk_sends"
  ON public.email_tenant_bulk_sends FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.bump_tenant_bulk_sends(p_tenant_id uuid, p_day date, p_n integer)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  INSERT INTO public.email_tenant_bulk_sends (tenant_id, day, sent)
  VALUES (p_tenant_id, p_day, greatest(p_n, 0))
  ON CONFLICT (tenant_id, day) DO UPDATE SET sent = email_tenant_bulk_sends.sent + greatest(p_n, 0)
  RETURNING sent;
$$;
REVOKE EXECUTE ON FUNCTION public.bump_tenant_bulk_sends(uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_tenant_bulk_sends(uuid, date, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.tenant_email_reputation(p_since timestamptz)
RETURNS TABLE (tenant_id uuid, reached integer, hard_bounces integer, complaints integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT e.tenant_id,
         count(*) FILTER (WHERE e.type IN ('delivered', 'bounced'))::int AS reached,
         count(*) FILTER (WHERE e.type = 'bounced' AND lower(coalesce(e.payload_min->'bounce'->>'type', '')) = 'permanent')::int AS hard_bounces,
         count(*) FILTER (WHERE e.type = 'complained')::int AS complaints
  FROM public.email_events e
  WHERE e.occurred_at >= p_since
  GROUP BY e.tenant_id;
$$;
REVOKE EXECUTE ON FUNCTION public.tenant_email_reputation(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_email_reputation(timestamptz) TO service_role;
