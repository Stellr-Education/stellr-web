-- Event add-ons on group invoices (docs/PLAN-event-add-ons-2026-11-17.md, Phase 3; US-20).
--
-- Add-ons a group pays for by invoice go onto the group's invoice while it is unpaid,
-- revised like a roster change; once the invoice is paid, a new invoice for the
-- add-ons only is issued (kind 'addons'), revised the same way while it is unpaid.
--
-- addons_cents is the add-on part of an invoice's total. The group's discount code
-- applies to the place line only (Q6), so the place part of a paid invoice is
-- total_cents - addons_cents: what each refund and per-place sum reads.

ALTER TABLE public.group_invoices DROP CONSTRAINT IF EXISTS group_invoices_kind_check;
ALTER TABLE public.group_invoices
  ADD CONSTRAINT group_invoices_kind_check CHECK (kind IN ('seats', 'additional', 'addons'));

ALTER TABLE public.group_invoices ADD COLUMN IF NOT EXISTS addons_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.group_invoices DROP CONSTRAINT IF EXISTS group_invoices_addons_cents_check;
ALTER TABLE public.group_invoices
  ADD CONSTRAINT group_invoices_addons_cents_check CHECK (addons_cents >= 0);

CREATE INDEX IF NOT EXISTS registration_addons_group_invoice_idx
  ON public.registration_addons (group_invoice_id) WHERE group_invoice_id IS NOT NULL;
