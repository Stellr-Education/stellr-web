-- Paid event merch is an event add-on now (docs/PLAN-event-add-ons-2026-11-17.md, Phase 6).
-- 20261117182507_event_addons copied every event_store_offerings row with treatment
-- 'addon' into event_addons (kind 'merch'); this removes the originals, so the store
-- table holds only what an event includes (the free shirt). Rows not yet copied (an
-- add-on offering created after that migration ran) are copied here first.

INSERT INTO public.event_addons (event_slug, kind, title, store_product_id, variant_ids, max_per_person, status, sort, created_by)
SELECT o.event_slug, 'merch', p.name, p.id, array_agg(DISTINCT o.variant_id), 10, 'on_sale', 100, 'migration:retire_merch_addon_offerings'
  FROM public.event_store_offerings o
  JOIN public.store_variants v ON v.id = o.variant_id
  JOIN public.store_products p ON p.id = v.product_id
 WHERE o.treatment = 'addon'
   AND NOT EXISTS (
     SELECT 1 FROM public.event_addons a
      WHERE a.event_slug = o.event_slug AND a.kind = 'merch' AND a.store_product_id = p.id
   )
 GROUP BY o.event_slug, p.id, p.name;

DELETE FROM public.event_store_offerings WHERE treatment = 'addon';
