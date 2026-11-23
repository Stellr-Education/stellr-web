-- Email events store (email plan, Workstream C, 23 Nov 2026).
--
-- Every delivery event the mail provider reports, one row per event per
-- message: sent, delivered, delivery_delayed, bounced, complained, opened,
-- clicked, suppressed, failed. Written only by the Resend webhook (and, in
-- Workstream F, the SES one) through lib/email/events.ts, with service_role.
-- It is the engagement base the in-portal community email will read, and
-- feeds the admin History tab and the dashboard's bounce and complaint rates.
--
-- Opens and clicks only arrive from the tracked community stream
-- (community.stellreducation.org); transactional mail has no tracking.
--
-- Idempotent on (provider, provider_email_id, type, occurred_at): a webhook
-- Resend redelivers writes nothing new, while a second open or click of the
-- same message at a later time is its own row.
--
-- tenant_id is the tenant whose sender sent the message: from the send's
-- tags, else the outbox row or event-email run that holds the provider id,
-- else Stellr. member_id is the recipient's members row when known; it is set
-- to NULL when the member is hard-deleted, and the row ages out with the
-- 13-month prune (/api/cron/email-events-retention; retention schedule row 37).

CREATE TABLE IF NOT EXISTS public.email_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL CHECK (provider IN ('resend', 'ses')),
  provider_email_id  text NOT NULL CHECK (char_length(provider_email_id) BETWEEN 1 AND 200),
  type               text NOT NULL CHECK (type IN (
                       'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained',
                       'opened', 'clicked', 'suppressed', 'failed')),
  tenant_id          uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  member_id          uuid REFERENCES public.members (id) ON DELETE SET NULL,
  recipient          text NOT NULL CHECK (char_length(recipient) <= 320),
  -- sha256 hex of the lower-cased, trimmed address: lets reporting join and
  -- count by recipient without reading the address itself.
  recipient_hash     text NOT NULL CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  stream             text CHECK (stream IS NULL OR char_length(stream) <= 40),
  feature            text CHECK (feature IS NULL OR char_length(feature) <= 80),
  ref                text CHECK (ref IS NULL OR char_length(ref) <= 200),
  -- Clicks only: the link's origin and path (query string and fragment dropped).
  link_url           text CHECK (link_url IS NULL OR char_length(link_url) <= 2000),
  occurred_at        timestamptz NOT NULL,
  -- The few provider fields worth keeping (bounce type and message, failure
  -- reason). Never the subject, body, IP address or user agent.
  payload_min        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_events_provider_event_key UNIQUE (provider, provider_email_id, type, occurred_at)
);

CREATE INDEX IF NOT EXISTS email_events_tenant_id_idx ON public.email_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_events_provider_email_id_idx ON public.email_events (provider_email_id);
CREATE INDEX IF NOT EXISTS email_events_type_occurred_idx ON public.email_events (type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_events_member_id_idx ON public.email_events (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_events_recipient_hash_idx ON public.email_events (recipient_hash);
CREATE INDEX IF NOT EXISTS email_events_occurred_at_idx ON public.email_events (occurred_at);

-- The webhook finds an untagged message's sender through the outbox by provider id.
CREATE INDEX IF NOT EXISTS email_outbox_provider_id_idx ON public.email_outbox (provider_id) WHERE provider_id IS NOT NULL;

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_events TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access email_events"
    ON public.email_events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tenant isolation (S4): a tenant session may read its own events, never write them.
GRANT SELECT ON public.email_events TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.email_events;
CREATE POLICY tenant_isolation ON public.email_events AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.email_events;
CREATE POLICY tenant_isolation_guard ON public.email_events AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));

COMMENT ON TABLE public.email_events IS
  'Every mail-provider delivery event per message and recipient (lib/email/events.ts). Pruned after 13 months.';
