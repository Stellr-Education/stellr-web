// Event add-ons: the catalogue (Phase 1 of docs/PLAN-event-add-ons-2026-11-17.md).
//
// Staff manage an event's add-ons from its admin page; public pages and booking
// screens read the published ones. Reads for the public go through
// getPublicAddons, cached per event and revalidated by tag when staff change
// anything (FR-16): no database call per page view, no personal data.

import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag, unstable_cache } from 'next/cache'
import { supabaseServer } from '@/lib/supabase'
import { computeUnitPrice } from '@/lib/store/pricing'
import { availability, onSale, publiclyListed, rowFromInput, type AddonInput } from './rules'
import {
  DEFAULT_ADDON_SETTINGS,
  LIVE_LINE_STATUSES,
  type AddonRow,
  type AddonSettings,
  type AddonVariant,
  type PublicAddon,
} from './types'

export const ADDONS_TAG = 'event-addons'
export const addonsTagFor = (slug: string) => `event-addons:${slug}`

const ADDON_COLUMNS =
  'id, event_slug, kind, title, description, includes, service_date, service_end_date, price_cents, currency, capacity, sale_opens_at, sale_closes_at, audience, refund_rule, refund_until, requires_addendum, minors_group_only, max_per_person, store_product_id, variant_ids, display_group, sort, status'

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

/** Units held against each add-on's capacity (live lines only). */
export async function takenByAddon(db: SupabaseClient, addonIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (addonIds.length === 0) return out
  const { data, error } = await db
    .from('registration_addons')
    .select('addon_id, quantity')
    .in('addon_id', addonIds)
    .in('status', [...LIVE_LINE_STATUSES])
  if (error) throw new Error(`add-on counts: ${error.message}`)
  for (const r of (data ?? []) as { addon_id: string; quantity: number }[]) {
    out.set(r.addon_id, (out.get(r.addon_id) ?? 0) + (r.quantity ?? 1))
  }
  return out
}

/** Merch add-ons' sizes on sale, each priced for this event (store price, event discount). */
export async function merchVariants(db: SupabaseClient, eventSlug: string, addons: Pick<AddonRow, 'id' | 'kind' | 'variant_ids'>[]): Promise<Map<string, AddonVariant[]>> {
  const out = new Map<string, AddonVariant[]>()
  const merch = addons.filter((a) => a.kind === 'merch' && (a.variant_ids ?? []).length > 0)
  const ids = [...new Set(merch.flatMap((a) => a.variant_ids))]
  if (ids.length === 0) return out
  const { data, error } = await db
    .from('store_variants')
    .select('id, sku, label, market_price_cents, active, product:store_products(id, product_type, status)')
    .in('id', ids)
  if (error) throw new Error(`add-on variants: ${error.message}`)
  const priced = new Map<string, AddonVariant>()
  for (const v of (data ?? []) as { id: string; sku: string; label: string | null; market_price_cents: number; active: boolean; product: unknown }[]) {
    const p = arr(v.product) as { id: string; product_type: string; status: string } | undefined
    if (!v.active || !p || p.status !== 'active') continue
    const price = await computeUnitPrice(
      { market_price_cents: v.market_price_cents, product_id: p.id },
      { product_type: p.product_type },
      { kind: 'event', eventSlug },
    )
    priced.set(v.id, { variantId: v.id, sku: v.sku, label: v.label ?? 'One size', unitCents: price.unit_cents })
  }
  for (const a of merch) out.set(a.id, a.variant_ids.map((id) => priced.get(id)).filter((v): v is AddonVariant => !!v))
  return out
}

/** Every add-on of an event, archived included, for its admin page. */
export async function loadAdminAddons(db: SupabaseClient, eventSlug: string) {
  const { data, error } = await db.from('event_addons').select(ADDON_COLUMNS).eq('event_slug', eventSlug).order('sort').order('created_at')
  if (error) throw new Error(`add-ons: ${error.message}`)
  const rows = (data ?? []) as AddonRow[]
  const [taken, variants] = await Promise.all([takenByAddon(db, rows.map((r) => r.id)), merchVariants(db, eventSlug, rows)])
  return rows.map((r) => ({ ...r, taken: taken.get(r.id) ?? 0, variants: variants.get(r.id) ?? [], variantIds: r.variant_ids ?? [] }))
}

/** Active store products and their sizes, for the merch picker. */
export async function loadStoreProductsForAddons(db: SupabaseClient) {
  const { data } = await db
    .from('store_products')
    .select('id, name, variants:store_variants(id, label, active)')
    .eq('status', 'active')
    .order('name')
  return (data ?? []) as { id: string; name: string; variants: { id: string; label: string | null; active: boolean }[] }[]
}

/** Variants must belong to the chosen product. Returns the ones that do. */
async function checkedVariantIds(db: SupabaseClient, productId: string, variantIds: string[]): Promise<string[]> {
  if (variantIds.length === 0) return []
  const { data } = await db.from('store_variants').select('id').eq('product_id', productId).in('id', variantIds)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

export type CatalogWrite = { ok: true; id: string } | { ok: false; status: number; error: string }

export async function createAddon(db: SupabaseClient, eventSlug: string, input: AddonInput, actor: string): Promise<CatalogWrite> {
  const row = rowFromInput(input)
  const variantIds = row.store_product_id ? await checkedVariantIds(db, row.store_product_id, input.variantIds) : []
  if (row.kind === 'merch' && variantIds.length === 0) return { ok: false, status: 400, error: 'None of those sizes belong to that product' }
  const { data, error } = await db
    .from('event_addons')
    .insert({ ...row, variant_ids: variantIds, event_slug: eventSlug, created_by: actor, updated_by: actor })
    .select('id')
    .single()
  if (error || !data) return { ok: false, status: 500, error: 'Could not save the add-on' }
  const id = (data as { id: string }).id
  bustAddonCache(eventSlug)
  return { ok: true, id }
}

export async function updateAddon(db: SupabaseClient, eventSlug: string, id: string, input: AddonInput, actor: string): Promise<CatalogWrite> {
  const { data: existing } = await db.from('event_addons').select('id, kind').eq('id', id).eq('event_slug', eventSlug).maybeSingle()
  if (!existing) return { ok: false, status: 404, error: 'Add-on not found' }
  if ((existing as { kind: string }).kind !== input.kind) return { ok: false, status: 400, error: "An add-on's kind can't change" }
  const row = rowFromInput(input)
  const variantIds = row.store_product_id ? await checkedVariantIds(db, row.store_product_id, input.variantIds) : []
  if (row.kind === 'merch' && variantIds.length === 0) return { ok: false, status: 400, error: 'None of those sizes belong to that product' }
  // Prices snapshot onto each booking line, so a change here affects later sales only (FR-2).
  const { error } = await db.from('event_addons').update({ ...row, variant_ids: variantIds, updated_by: actor }).eq('id', id).eq('event_slug', eventSlug)
  if (error) return { ok: false, status: 500, error: 'Could not save the add-on' }
  bustAddonCache(eventSlug)
  return { ok: true, id }
}

/**
 * Remove an add-on. One that has ever been booked is archived instead (hidden
 * from sale, bookings kept); one never booked is deleted.
 */
export async function removeAddon(db: SupabaseClient, eventSlug: string, id: string, actor: string): Promise<{ ok: boolean; archived: boolean; status?: number }> {
  const { data: existing } = await db.from('event_addons').select('id').eq('id', id).eq('event_slug', eventSlug).maybeSingle()
  if (!existing) return { ok: false, archived: false, status: 404 }
  const { count } = await db.from('registration_addons').select('id', { count: 'exact', head: true }).eq('addon_id', id)
  if ((count ?? 0) > 0) {
    await db.from('event_addons').update({ status: 'archived', updated_by: actor }).eq('id', id)
    bustAddonCache(eventSlug)
    return { ok: true, archived: true }
  }
  const { error } = await db.from('event_addons').delete().eq('id', id).eq('event_slug', eventSlug)
  bustAddonCache(eventSlug)
  return { ok: !error, archived: false, status: error ? 500 : 200 }
}

export async function loadAddonSettings(db: SupabaseClient, eventSlug: string): Promise<AddonSettings> {
  const { data } = await db.from('event_addon_settings').select('merch_upsell, inclusions').eq('event_slug', eventSlug).maybeSingle()
  if (!data) return { ...DEFAULT_ADDON_SETTINGS }
  const r = data as { merch_upsell: boolean; inclusions: string[] | null }
  return { merchUpsell: r.merch_upsell, inclusions: r.inclusions ?? [] }
}

export async function saveAddonSettings(db: SupabaseClient, eventSlug: string, s: AddonSettings, actor: string) {
  const { error } = await db
    .from('event_addon_settings')
    .upsert({ event_slug: eventSlug, merch_upsell: s.merchUpsell, inclusions: s.inclusions, updated_by: actor }, { onConflict: 'event_slug' })
  bustAddonCache(eventSlug)
  return { ok: !error }
}

export function bustAddonCache(eventSlug: string) {
  try {
    revalidateTag(addonsTagFor(eventSlug), { expire: 0 })
    revalidateTag(ADDONS_TAG, { expire: 0 })
  } catch {
    // Outside a request (scripts, tests): nothing is cached.
  }
}

/** The published add-ons of an event, for public pages and booking screens. Uncached. */
export async function loadPublicAddons(db: SupabaseClient, eventSlug: string, now: Date = new Date()): Promise<{ addons: PublicAddon[]; settings: AddonSettings }> {
  const [{ data, error }, settings] = await Promise.all([
    db.from('event_addons').select(ADDON_COLUMNS).eq('event_slug', eventSlug).in('status', ['on_sale', 'closed']).order('sort').order('created_at'),
    loadAddonSettings(db, eventSlug),
  ])
  if (error) throw new Error(`public add-ons: ${error.message}`)
  const rows = ((data ?? []) as AddonRow[]).filter(publiclyListed)
  const [taken, variants] = await Promise.all([
    takenByAddon(db, rows.map((r) => r.id)),
    merchVariants(db, eventSlug, rows),
  ])
  const addons: PublicAddon[] = []
  for (const r of rows) {
    const vs = variants.get(r.id) ?? []
    if (r.kind === 'merch' && vs.length === 0) continue
    const sold = onSale(r, now) ? availability(r.capacity, taken.get(r.id) ?? 0) : 'sold_out'
    addons.push({
      id: r.id,
      kind: r.kind,
      title: r.title,
      description: r.description,
      includes: r.includes ?? [],
      serviceDate: r.service_date,
      serviceEndDate: r.service_end_date,
      priceCents: r.kind === 'merch' ? Math.min(...vs.map((v) => v.unitCents)) : r.price_cents,
      currency: r.currency,
      displayGroup: r.display_group,
      audience: r.audience,
      maxPerPerson: r.max_per_person,
      minorsGroupOnly: r.minors_group_only,
      requiresAddendum: r.requires_addendum,
      saleClosesAt: r.sale_closes_at,
      availability: sold,
      variants: vs,
    })
  }
  return { addons, settings }
}

/**
 * Cached reader for public pages. Revalidates on any staff change (bustAddonCache)
 * and every 10 minutes, so availability stays roughly current without a query per view.
 */
export function getPublicAddons(eventSlug: string) {
  return unstable_cache(
    async () => {
      try {
        return await loadPublicAddons(supabaseServer(), eventSlug)
      } catch (e) {
        console.warn('[addons] public read failed, showing none:', e instanceof Error ? e.message : e)
        return { addons: [] as PublicAddon[], settings: { ...DEFAULT_ADDON_SETTINGS } }
      }
    },
    ['event-addons-public', eventSlug],
    { revalidate: 600, tags: [ADDONS_TAG, addonsTagFor(eventSlug)] },
  )()
}

/**
 * Which non-merch add-on kinds each event has on sale, for the event card pill
 * (US-8). Merch never shows on cards. One cached query for the whole board.
 */
export const getAddonKindsBySlug = unstable_cache(
  async (): Promise<Record<string, ('accommodation' | 'experience')[]>> => {
    try {
      const { data, error } = await supabaseServer()
        .from('event_addons')
        .select('event_slug, kind, status, sale_opens_at, sale_closes_at')
        .in('kind', ['accommodation', 'experience'])
        .eq('status', 'on_sale')
      if (error) throw error
      const out: Record<string, ('accommodation' | 'experience')[]> = {}
      for (const r of (data ?? []) as Pick<AddonRow, 'event_slug' | 'kind' | 'status' | 'sale_opens_at' | 'sale_closes_at'>[]) {
        if (!onSale(r)) continue
        const kinds = (out[r.event_slug] ??= [])
        const k = r.kind as 'accommodation' | 'experience'
        if (!kinds.includes(k)) kinds.push(k)
      }
      return out
    } catch (e) {
      console.warn('[addons] card kinds read failed:', e instanceof Error ? e.message : e)
      return {}
    }
  },
  ['event-addon-kinds'],
  { revalidate: 600, tags: [ADDONS_TAG] },
)
