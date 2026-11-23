-- Email plan Workstream D (23 Nov 2026): per-tenant email settings.
--
-- One row per tenant (Stellr included) holding its sender and, when it has one,
-- its own sending domain verified in Resend from the super-admin console:
--
--   • sending_domain / resend_domain_id / domain_status / forge_status: the
--     tenant's own domain (e.g. mail.example.org). Mail uses it only while
--     domain_status = 'verified'; otherwise it falls back to the platform's
--     "<Tenant> via Stellr" <no-reply@mail.stellreducation.org>.
--   • from_local_part / from_name / reply_to: who the mail is from and where
--     replies go. reply_to replaces tenants.branding.reply_to (backfilled here;
--     the old key is still read as a fallback until every tenant has a row).
--   • signature_html / signature_text / logo_url: the event-mail signature
--     (Workstream G); NULL keeps today's.
--   • marketing_daily_cap / marketing_monthly_cap / marketing_paused_at /
--     paused_reason: Workstream E's per-tenant caps and kill switch.
--
-- Platform-level although it carries tenant_id: written and read only by
-- service_role (the console and lib/email), never by tenant_app or
-- tenant_support_ro. What this does to live data: a new table, plus one row per
-- tenant whose branding already has a reply_to.

CREATE TABLE IF NOT EXISTS public.tenant_email_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  sending_domain        text CHECK (sending_domain IS NULL OR sending_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  resend_domain_id      text CHECK (resend_domain_id IS NULL OR char_length(resend_domain_id) BETWEEN 1 AND 100),
  domain_status         text NOT NULL DEFAULT 'none'
                        CHECK (domain_status IN ('none', 'not_started', 'pending', 'verified', 'failed', 'temporary_failure')),
  forge_status          text NOT NULL DEFAULT 'off' CHECK (forge_status IN ('off', 'pending', 'verified')),
  domain_checked_at     timestamptz,
  from_local_part       text NOT NULL DEFAULT 'events' CHECK (from_local_part ~ '^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$'),
  from_name             text CHECK (from_name IS NULL OR char_length(from_name) BETWEEN 1 AND 64),
  reply_to              text CHECK (reply_to IS NULL OR (char_length(reply_to) <= 254 AND reply_to ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$')),
  signature_html        text CHECK (signature_html IS NULL OR char_length(signature_html) <= 20000),
  signature_text        text CHECK (signature_text IS NULL OR char_length(signature_text) <= 5000),
  logo_url              text CHECK (logo_url IS NULL OR (char_length(logo_url) <= 1000 AND logo_url ~ '^https://')),
  marketing_daily_cap   integer CHECK (marketing_daily_cap IS NULL OR marketing_daily_cap >= 0),
  marketing_monthly_cap integer CHECK (marketing_monthly_cap IS NULL OR marketing_monthly_cap >= 0),
  marketing_paused_at   timestamptz,
  paused_reason         text CHECK (paused_reason IS NULL OR char_length(paused_reason) <= 300),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            text CHECK (updated_by IS NULL OR char_length(updated_by) BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_email_settings_domain_key
  ON public.tenant_email_settings (sending_domain) WHERE sending_domain IS NOT NULL;

COMMENT ON TABLE public.tenant_email_settings IS
  'Email plan D: a tenant''s sender, own sending domain (Resend), signature and marketing caps. service_role only (lib/email/tenant-settings.ts, the super-admin console).';

ALTER TABLE public.tenant_email_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_email_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_email_settings TO service_role;
DROP POLICY IF EXISTS "service role full access tenant_email_settings" ON public.tenant_email_settings;
CREATE POLICY "service role full access tenant_email_settings"
  ON public.tenant_email_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Backfill: every tenant whose branding has a well-formed reply_to keeps it.
INSERT INTO public.tenant_email_settings (tenant_id, reply_to, updated_by)
SELECT t.id, btrim(t.branding->>'reply_to'), 'migration'
FROM public.tenants t
WHERE t.branding ? 'reply_to'
  AND char_length(btrim(t.branding->>'reply_to')) <= 254
  AND btrim(t.branding->>'reply_to') ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'
ON CONFLICT (tenant_id) DO NOTHING;
