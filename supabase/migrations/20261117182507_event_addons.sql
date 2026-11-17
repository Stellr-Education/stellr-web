-- Event add-ons (docs/PLAN-event-add-ons-2026-11-17.md, Phases 1 and 2).
--
-- An add-on is an optional extra an event offers on top of a place:
-- accommodation (one row per night), an experience (a tour), or merch (a
-- store product, sized at booking). Staff set them up per event; organisers
-- and registrants book them for named people attending the event; each
-- booking line has its own payer.
--
--   event_addons          the catalogue, per event (for merch, variant_ids holds
--                         the store sizes on sale)
--   event_addon_settings  per event: the merch upsell (on by default) and what
--                         the place already includes
--   addon_orders          one Checkout or pay link covering lines with the same
--                         payer (lines on a group invoice carry no order)
--   registration_addons   the booking lines: one participant x one add-on
--                         (x one variant, for merch)
--
-- Stellr's events only: the app refuses add-ons on any other tenant's event
-- (plan section 1, "Out of scope"). The tables still carry tenant_id, as every
-- event table must (lib/tenancy/registry.ts).
--
-- Today's merch add-ons (event_store_offerings, treatment 'addon') are copied
-- into the catalogue at the end. event_store_offerings stays, read only for
-- add-ons, until Phase 6 retires it.

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_addons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  event_slug          text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('accommodation', 'experience', 'merch')),
  title               text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description         text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  includes            text[] NOT NULL DEFAULT '{}',
  service_date        date,
  service_end_date    date,
  -- Accommodation and experiences carry their own price. Merch is priced from
  -- the store (store_variants through computeUnitPrice), so it has none here.
  price_cents         integer CHECK (price_cents IS NULL OR price_cents >= 0),
  -- Set from the event by the trigger below; never written by the app.
  currency            text NOT NULL DEFAULT 'usd' CHECK (currency IN ('usd', 'aud')),
  -- In people. NULL is unlimited. Merch has none.
  capacity            integer CHECK (capacity IS NULL OR capacity >= 0),
  sale_opens_at       timestamptz,
  sale_closes_at      timestamptz,
  audience            text NOT NULL DEFAULT 'all' CHECK (audience IN ('students', 'adults', 'all')),
  -- until_cutoff: full refund until refund_until (or sale_closes_at), none after.
  -- event_policy: follows the event's refund policy. none: never refunded.
  -- Merch is refundable until the event's merch batch is committed, whatever this says.
  refund_rule         text NOT NULL DEFAULT 'until_cutoff' CHECK (refund_rule IN ('until_cutoff', 'event_policy', 'none')),
  refund_until        timestamptz,
  -- A minor's line waits for the December participant-and-parent addendum (FR-5b).
  requires_addendum   boolean NOT NULL DEFAULT false,
  -- A minor on an individual registration can't book it (FR-5a). On by default for accommodation.
  minors_group_only   boolean NOT NULL DEFAULT false,
  -- Units of this add-on one person may hold. 1 for accommodation and experiences.
  max_per_person      integer NOT NULL DEFAULT 1 CHECK (max_per_person BETWEEN 1 AND 100),
  store_product_id    uuid REFERENCES public.store_products (id) ON DELETE RESTRICT,
  -- Merch: the store variants (sizes) on sale. Checked against store_product_id by the app.
  variant_ids         uuid[] NOT NULL DEFAULT '{}',
  display_group       text CHECK (display_group IS NULL OR char_length(display_group) <= 100),
  sort                integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'on_sale', 'closed', 'archived')),
  created_by          text,
  updated_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_addons_kind_shape CHECK (
    (kind = 'merch' AND store_product_id IS NOT NULL AND price_cents IS NULL AND capacity IS NULL)
    OR (kind <> 'merch' AND store_product_id IS NULL AND price_cents IS NOT NULL)
  ),
  CONSTRAINT event_addons_dates CHECK (service_end_date IS NULL OR service_date IS NULL OR service_end_date >= service_date),
  CONSTRAINT event_addons_sale_window CHECK (sale_closes_at IS NULL OR sale_opens_at IS NULL OR sale_closes_at > sale_opens_at),
  CONSTRAINT event_addons_single_unit CHECK (kind = 'merch' OR max_per_person = 1)
);

CREATE INDEX IF NOT EXISTS event_addons_tenant_id_idx ON public.event_addons (tenant_id);
CREATE INDEX IF NOT EXISTS event_addons_event_idx ON public.event_addons (event_slug, sort);

-- Per event: the merch upsell and what the place includes.
CREATE TABLE IF NOT EXISTS public.event_addon_settings (
  event_slug    text PRIMARY KEY,
  tenant_id     uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  -- Owner, 17 Nov 2026: on by default for every event. No row reads as on.
  merch_upsell  boolean NOT NULL DEFAULT true,
  inclusions    text[] NOT NULL DEFAULT '{}',
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_addon_settings_tenant_id_idx ON public.event_addon_settings (tenant_id);

-- ---------------------------------------------------------------------------
-- Orders and booking lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.addon_orders (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  event_slug                  text NOT NULL,
  registration_id             uuid REFERENCES public.registrations (id) ON DELETE SET NULL,
  -- group: the organiser pays (card). self: one participant's own pay link.
  payer_kind                  text NOT NULL CHECK (payer_kind IN ('group', 'self')),
  payer_participant_id        uuid REFERENCES public.participants (id) ON DELETE SET NULL,
  method                      text NOT NULL DEFAULT 'card' CHECK (method IN ('card')),
  status                      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  total_cents                 integer NOT NULL CHECK (total_cents >= 0),
  currency                    text NOT NULL DEFAULT 'usd' CHECK (currency IN ('usd', 'aud')),
  stripe_checkout_session_id  text UNIQUE,
  stripe_payment_intent_id    text,
  pay_token                   text UNIQUE,
  reminder_sent_at            timestamptz,
  paid_at                     timestamptz,
  created_by                  text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addon_orders_self_has_payer CHECK (payer_kind <> 'self' OR payer_participant_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS addon_orders_tenant_id_idx ON public.addon_orders (tenant_id);
CREATE INDEX IF NOT EXISTS addon_orders_registration_idx ON public.addon_orders (registration_id);
CREATE INDEX IF NOT EXISTS addon_orders_open_idx ON public.addon_orders (event_slug) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.registration_addons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  registration_id       uuid NOT NULL REFERENCES public.registrations (id) ON DELETE CASCADE,
  participant_id        uuid NOT NULL REFERENCES public.participants (id) ON DELETE CASCADE,
  addon_id              uuid NOT NULL REFERENCES public.event_addons (id) ON DELETE RESTRICT,
  variant_id            uuid REFERENCES public.store_variants (id) ON DELETE RESTRICT,
  quantity              integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100),
  order_id              uuid REFERENCES public.addon_orders (id) ON DELETE SET NULL,
  -- The group invoice this line is billed on (Phase 3), when the payer is the group by invoice.
  group_invoice_id      uuid REFERENCES public.group_invoices (id) ON DELETE SET NULL,
  unit_price_cents      integer NOT NULL CHECK (unit_price_cents >= 0),
  currency              text NOT NULL DEFAULT 'usd' CHECK (currency IN ('usd', 'aud')),
  -- group: the organiser (card, or the group's invoice). self: the person's own link.
  -- included: waived by staff, or free. offline: marked paid by staff.
  payer                 text NOT NULL CHECK (payer IN ('group', 'self', 'included', 'offline')),
  -- How a group line is paid: card or the group's invoice. NULL for other payers.
  group_method          text CHECK (group_method IS NULL OR group_method IN ('card', 'invoice')),
  status                text NOT NULL DEFAULT 'pending_payment'
                          CHECK (status IN ('pending_payment', 'pending_consent', 'confirmed', 'cancelled', 'refunded', 'expired')),
  paid_at               timestamptz,
  booked_by_member_id   uuid REFERENCES public.members (id) ON DELETE SET NULL,
  booked_by_role        text CHECK (booked_by_role IS NULL OR booked_by_role IN ('staff', 'teacher', 'teacher_poc', 'student_manager', 'self')),
  -- Staff let a minor on an individual registration book a group-only add-on (FR-5a).
  minor_rule_override   boolean NOT NULL DEFAULT false,
  store_order_item_id   uuid REFERENCES public.store_order_items (id) ON DELETE SET NULL,
  cancelled_at          timestamptz,
  cancel_reason         text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_addons_group_method CHECK ((payer = 'group') = (group_method IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS registration_addons_tenant_id_idx ON public.registration_addons (tenant_id);
CREATE INDEX IF NOT EXISTS registration_addons_registration_idx ON public.registration_addons (registration_id);
CREATE INDEX IF NOT EXISTS registration_addons_participant_idx ON public.registration_addons (participant_id);
CREATE INDEX IF NOT EXISTS registration_addons_addon_idx ON public.registration_addons (addon_id) WHERE status IN ('pending_payment', 'pending_consent', 'confirmed');
CREATE INDEX IF NOT EXISTS registration_addons_order_idx ON public.registration_addons (order_id);
-- One live line per person per add-on (per size, for merch).
CREATE UNIQUE INDEX IF NOT EXISTS registration_addons_one_live
  ON public.registration_addons (participant_id, addon_id, variant_id) NULLS NOT DISTINCT
  WHERE status IN ('pending_payment', 'pending_consent', 'confirmed');

-- Refunds of an add-on line (Phase 4).
ALTER TABLE public.event_refunds ADD COLUMN IF NOT EXISTS addon_line_id uuid REFERENCES public.registration_addons (id) ON DELETE SET NULL;
ALTER TABLE public.event_refunds DROP CONSTRAINT IF EXISTS event_refunds_kind_check;
ALTER TABLE public.event_refunds
  ADD CONSTRAINT event_refunds_kind_check CHECK (kind IN ('cancellation', 'scholarship', 'share_true_up', 'share_unwind', 'addon'));
CREATE UNIQUE INDEX IF NOT EXISTS event_refunds_one_per_addon_line
  ON public.event_refunds (addon_line_id) WHERE kind = 'addon';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- An add-on's currency is its event's. An unmirrored slug is Stellr's (USD).
CREATE OR REPLACE FUNCTION public.event_addons_set_currency() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.currency := coalesce((SELECT e.currency FROM public.events e WHERE e.slug = NEW.event_slug), 'usd');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.event_addons_set_currency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_addons_currency ON public.event_addons;
CREATE TRIGGER event_addons_currency
  BEFORE INSERT OR UPDATE OF event_slug, currency ON public.event_addons
  FOR EACH ROW EXECUTE FUNCTION public.event_addons_set_currency();

DROP TRIGGER IF EXISTS event_addons_updated_at ON public.event_addons;
CREATE TRIGGER event_addons_updated_at BEFORE UPDATE ON public.event_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS event_addon_settings_updated_at ON public.event_addon_settings;
CREATE TRIGGER event_addon_settings_updated_at BEFORE UPDATE ON public.event_addon_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS addon_orders_updated_at ON public.addon_orders;
CREATE TRIGGER addon_orders_updated_at BEFORE UPDATE ON public.addon_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS registration_addons_updated_at ON public.registration_addons;
CREATE TRIGGER registration_addons_updated_at BEFORE UPDATE ON public.registration_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tenant derivation (S3): from the event key, or from the parent row.
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_addons;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_addons
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.event_addon_settings;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.event_addon_settings
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.addon_orders;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF event_slug, tenant_id ON public.addon_orders
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_derive_tenant_id('event_slug', 'slug');
DROP TRIGGER IF EXISTS zz_tenancy_derive_tenant_id ON public.registration_addons;
CREATE TRIGGER zz_tenancy_derive_tenant_id
  BEFORE INSERT OR UPDATE OF registration_id, tenant_id ON public.registration_addons
  FOR EACH ROW EXECUTE FUNCTION public.tenancy_inherit_tenant_id('registration_id', 'registrations');

-- ---------------------------------------------------------------------------
-- Booking with a capacity check, in one statement
-- ---------------------------------------------------------------------------
-- Locks the add-on row, counts its live lines, and inserts the new ones only
-- if they fit (FR-4). Raises 'addon_sold_out' otherwise. Called by the app's
-- service role; not SECURITY DEFINER, so RLS and grants apply as usual.
CREATE OR REPLACE FUNCTION public.book_addon_lines(p_addon uuid, p_lines jsonb)
  RETURNS SETOF public.registration_addons
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity integer;
  v_taken    integer;
  v_new      integer;
BEGIN
  SELECT capacity INTO v_capacity FROM public.event_addons WHERE id = p_addon FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'addon_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_capacity IS NOT NULL THEN
    SELECT coalesce(sum(quantity), 0) INTO v_taken FROM public.registration_addons
     WHERE addon_id = p_addon AND status IN ('pending_payment', 'pending_consent', 'confirmed');
    SELECT coalesce(sum(coalesce((l->>'quantity')::int, 1)), 0) INTO v_new FROM jsonb_array_elements(p_lines) l;
    IF v_taken + v_new > v_capacity THEN
      RAISE EXCEPTION 'addon_sold_out' USING ERRCODE = 'P0001', DETAIL = (v_capacity - v_taken)::text;
    END IF;
  END IF;
  RETURN QUERY
  INSERT INTO public.registration_addons (
    registration_id, participant_id, addon_id, variant_id, quantity, unit_price_cents, currency,
    payer, group_method, status, booked_by_member_id, booked_by_role, minor_rule_override
  )
  SELECT (l->>'registration_id')::uuid, (l->>'participant_id')::uuid, p_addon, nullif(l->>'variant_id', '')::uuid,
         coalesce((l->>'quantity')::int, 1), (l->>'unit_price_cents')::int, l->>'currency',
         l->>'payer', nullif(l->>'group_method', ''), coalesce(l->>'status', 'pending_payment'),
         nullif(l->>'booked_by_member_id', '')::uuid, nullif(l->>'booked_by_role', ''),
         coalesce((l->>'minor_rule_override')::boolean, false)
    FROM jsonb_array_elements(p_lines) l
  RETURNING *;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.book_addon_lines(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_addon_lines(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Row level security, grants and tenant policies
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_addon_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_addons ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.event_addons, public.event_addon_settings, public.addon_orders, public.registration_addons FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_addons, public.event_addon_settings, public.addon_orders, public.registration_addons TO service_role;

DO $$ BEGIN
  CREATE POLICY "service role full access event_addons" ON public.event_addons FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role full access event_addon_settings" ON public.event_addon_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role full access addon_orders" ON public.addon_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role full access registration_addons" ON public.registration_addons FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- public.event_addons (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_addons TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_addons;
CREATE POLICY tenant_isolation ON public.event_addons AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_addons;
CREATE POLICY tenant_isolation_guard ON public.event_addons AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_addons.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_addons.event_slug)));

-- public.event_addon_settings (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_addon_settings TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.event_addon_settings;
CREATE POLICY tenant_isolation ON public.event_addon_settings AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_addon_settings;
CREATE POLICY tenant_isolation_guard ON public.event_addon_settings AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_addon_settings.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_addon_settings.event_slug)));

-- public.addon_orders (event_scoped, derived from event_slug)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addon_orders TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.addon_orders;
CREATE POLICY tenant_isolation ON public.addon_orders AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.addon_orders;
CREATE POLICY tenant_isolation_guard ON public.addon_orders AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (addon_orders.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = addon_orders.event_slug))
    AND (addon_orders.payer_participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = addon_orders.payer_participant_id))
    AND (addon_orders.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = addon_orders.registration_id)));

-- public.registration_addons (event_scoped, inherited from public.registrations)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.registration_addons TO tenant_app;
DROP POLICY IF EXISTS tenant_isolation ON public.registration_addons;
CREATE POLICY tenant_isolation ON public.registration_addons AS PERMISSIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_guard ON public.registration_addons;
CREATE POLICY tenant_isolation_guard ON public.registration_addons AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (registration_addons.addon_id IS NULL OR EXISTS (SELECT 1 FROM public.event_addons p WHERE p.id = registration_addons.addon_id))
    AND (registration_addons.group_invoice_id IS NULL OR EXISTS (SELECT 1 FROM public.group_invoices p WHERE p.id = registration_addons.group_invoice_id))
    AND (registration_addons.order_id IS NULL OR EXISTS (SELECT 1 FROM public.addon_orders p WHERE p.id = registration_addons.order_id))
    AND (registration_addons.participant_id IS NULL OR EXISTS (SELECT 1 FROM public.participants p WHERE p.id = registration_addons.participant_id))
    AND (registration_addons.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = registration_addons.registration_id))
    AND (registration_addons.store_order_item_id IS NULL OR EXISTS (SELECT 1 FROM public.store_order_items p WHERE p.id = registration_addons.store_order_item_id)));

-- public.event_refunds: its guard gains the new addon_line_id key (lib/tenancy/tenant-role.ts).
DROP POLICY IF EXISTS tenant_isolation_guard ON public.event_refunds;
CREATE POLICY tenant_isolation_guard ON public.event_refunds AS RESTRICTIVE FOR ALL TO tenant_app
  USING (tenant_id = (SELECT public.app_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.app_tenant_id())
    AND (event_refunds.event_slug IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.slug = event_refunds.event_slug))
    AND (event_refunds.addon_line_id IS NULL OR EXISTS (SELECT 1 FROM public.registration_addons p WHERE p.id = event_refunds.addon_line_id))
    AND (event_refunds.registration_id IS NULL OR EXISTS (SELECT 1 FROM public.registrations p WHERE p.id = event_refunds.registration_id)));

-- A registration moved to another tenant takes its add-on lines with it, as it does
-- its participants (20261106074112_via_parent_tenant_carry.sql).
DROP TRIGGER IF EXISTS zzz_tenancy_carry_children ON public.registrations;
CREATE TRIGGER zzz_tenancy_carry_children
  AFTER UPDATE ON public.registrations
  FOR EACH ROW
  WHEN (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND OLD.tenant_id <> NEW.tenant_id)
  EXECUTE FUNCTION public.tenancy_carry_children('participants', 'registration_id', 'registration_addons', 'registration_id');

-- ---------------------------------------------------------------------------
-- Backfill: today's merch add-ons become merch add-ons in the catalogue
-- ---------------------------------------------------------------------------
-- One add-on per (event, product), on sale, up to 10 per person (Q13c), with the
-- sizes that event already offered.
INSERT INTO public.event_addons (event_slug, kind, title, store_product_id, variant_ids, max_per_person, status, sort, created_by)
SELECT o.event_slug, 'merch', p.name, p.id, array_agg(DISTINCT o.variant_id), 10, 'on_sale', 100, 'migration:event_addons'
  FROM public.event_store_offerings o
  JOIN public.store_variants v ON v.id = o.variant_id
  JOIN public.store_products p ON p.id = v.product_id
 WHERE o.treatment = 'addon'
   AND NOT EXISTS (
     SELECT 1 FROM public.event_addons a
      WHERE a.event_slug = o.event_slug AND a.kind = 'merch' AND a.store_product_id = p.id
   )
 GROUP BY o.event_slug, p.id, p.name;

COMMENT ON TABLE public.event_addons IS 'Optional extras an event offers on top of a place: accommodation, experiences, merch (lib/addons, docs/PLAN-event-add-ons-2026-11-17.md).';
COMMENT ON TABLE public.registration_addons IS 'Add-on booking lines: one attending participant x one add-on (x one variant for merch), each with its own payer (lib/addons).';
COMMENT ON TABLE public.addon_orders IS 'A Checkout or pay link covering add-on lines with the same payer (lib/addons/checkout.ts).';
COMMENT ON TABLE public.event_addon_settings IS 'Per event: the merch upsell (on by default) and what the place includes.';
