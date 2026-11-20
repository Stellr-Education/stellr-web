// Event-merchandise allocation for the web store (PRD §12, Phase 3 + 3b).
//
// One event-merch order per registration (channel='event_registration') holds
// the free "included" shirt (one per participant, sized from their t-shirt size)
// and paid event merch. Everything is batch-mode (fulfillment_status flows
// pending → awaiting_batch → ordered) and is rolled into the Event Manager's
// single bulk Printful order in Phase 4.
//
// Paid event merch is an event add-on now (lib/addons, docs/PLAN-event-add-ons-2026-11-17.md):
// it is booked and paid like any add-on and joins this order once paid
// (lib/addons/fulfil.ts). The old path that put merch into the registration's own
// Checkout is retired; what remains of it reads only items written before then:
//   • on confirmation: included shirts allocated, any such earlier 'pending' items
//     flipped to 'awaiting_batch', and the order marked 'paid' (finalizeRegistrationMerch)

import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { loadEventTenantId } from '@/lib/authz/principal'
import { reportError } from '@/lib/app-errors'

const arr = <T>(x: T | T[] | null | undefined): T | undefined =>
  Array.isArray(x) ? x[0] : (x ?? undefined)

function normSize(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s*\(.*\)\s*/g, '')
}

interface VariantLite {
  id: string
  label: string | null
  options: Record<string, string> | null
  sku: string
  active?: boolean
}

// Pick the variant of an included product that matches a participant's size.
function resolveVariantForSize(variants: VariantLite[], size: unknown): VariantLite | null {
  const s = normSize(size)
  if (!s) return null
  for (const v of variants) {
    if (v.options?.size && normSize(v.options.size) === s) return v
  }
  for (const v of variants) {
    const tokens = String(v.label ?? '').toLowerCase().split(/[/,]/).map((t) => normSize(t))
    if (tokens.includes(s)) return v
  }
  return null
}

interface IncludedOffering {
  productId: string
  productName: string
  variants: VariantLite[]
  fallbackVariant: VariantLite | null
}

async function getIncludedOfferings(db: SupabaseClient, eventSlug: string): Promise<IncludedOffering[]> {
  const { data: offs } = await db
    .from('event_store_offerings')
    .select('id, variant_id, treatment, variant:store_variants(id, product_id)')
    .eq('event_slug', eventSlug)
    .eq('treatment', 'included')

  const result: IncludedOffering[] = []
  for (const o of offs ?? []) {
    const v = arr((o as { variant?: unknown }).variant) as { id: string; product_id: string } | undefined
    const productId = v?.product_id
    if (!productId) continue
    const { data: product } = await db.from('store_products').select('name').eq('id', productId).maybeSingle()
    const { data: variants } = await db
      .from('store_variants')
      .select('id, label, options, sku, active')
      .eq('product_id', productId)
      .eq('active', true)
    const vlist = (variants ?? []) as VariantLite[]
    result.push({
      productId,
      productName: (product as { name?: string } | null)?.name ?? 'Event shirt',
      variants: vlist,
      fallbackVariant: vlist.find((x) => x.id === v?.id) ?? vlist[0] ?? null,
    })
  }
  return result
}

/** The event's owner could not be read, so no event-merch order was made or found. */
export class EventMerchOwnerReadError extends Error {
  constructor(cause: unknown) {
    super('Event-merch order: the event owner could not be read', { cause })
    this.name = 'EventMerchOwnerReadError'
  }
}

// Get (or create) the single event-merch order for a registration.
export async function ensureEventMerchOrder(db: SupabaseClient, registrationId: string): Promise<string | null> {
  const { data: existing } = await db
    .from('store_orders')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('channel', 'event_registration')
    .maybeSingle()
  if (existing) return (existing as { id: string }).id

  const { data: reg } = await db
    .from('registrations')
    .select('event_slug, teacher_member_id, teacher_email')
    .eq('id', registrationId)
    .maybeSingle()
  const r = reg as { event_slug: string | null; teacher_member_id: string | null; teacher_email: string | null } | null
  if (!r?.event_slug) return null

  // S5 C20a: the store is Stellr-only in release 1 (plan decision 12). The order's
  // tenant is its event's owner, read once here, before the order exists, by the rule
  // C20c's refuseUnlessStellrEvent applies (loadEventTenantId: an unmirrored slug counts
  // as Stellr's, a failed read is never Stellr's). So another tenant's event gets no
  // event-merch order, and no add-on is persisted or charged (registration-checkout reads
  // add-ons from this order). What is left is Stellr's event, so the row carries Stellr's
  // tenant_id, the value the S3 trigger derives for it today.
  //
  // A failed owner read throws (backlog-batch2.12 follow-up). Every event is Stellr's today,
  // so answering it as "no order" would drop a registrant's chosen add-ons for a transient
  // fault and send them to a checkout without them. Thrown, the registration answers a 500
  // that its route records in app_errors; finalizeRegistrationMerch, which must never break
  // a confirmation, catches it and records it there itself.
  let owner: string
  try {
    owner = await loadEventTenantId(db, r.event_slug)
  } catch (err) {
    console.error('[store/event-merch] event owner lookup failed:', err instanceof Error ? err.message : err)
    throw new EventMerchOwnerReadError(err)
  }
  if (owner !== STELLR_TENANT_ID) return null

  const { data: firstPart } = await db
    .from('participants')
    .select('member_id')
    .eq('registration_id', registrationId)
    .not('member_id', 'is', null)
    .limit(1)
    .maybeSingle()

  const { data: order } = await db
    .from('store_orders')
    .insert({
      tenant_id: STELLR_TENANT_ID,
      member_id: r.teacher_member_id ?? (firstPart as { member_id?: string } | null)?.member_id ?? null,
      email: r.teacher_email ?? '',
      status: 'pending',
      channel: 'event_registration',
      event_slug: r.event_slug,
      registration_id: registrationId,
      subtotal_cents: 0,
      discount_cents: 0,
      total_cents: 0,
    })
    .select('id')
    .single()
  return (order as { id?: string } | null)?.id ?? null
}

// Allocate the included shirt(s) to every participant — idempotent at the item
// level so it coexists with add-ons in the same order.
async function allocateIncludedShirts(db: SupabaseClient, registrationId: string): Promise<void> {
  const orderId = await ensureEventMerchOrder(db, registrationId)
  if (!orderId) return

  const { data: alreadyIncluded } = await db
    .from('store_order_items')
    .select('id')
    .eq('order_id', orderId)
    .eq('line_source', 'event_included')
    .limit(1)
    .maybeSingle()
  if (alreadyIncluded) return

  const { data: regRow } = await db.from('registrations').select('event_slug').eq('id', registrationId).maybeSingle()
  const eventSlug = (regRow as { event_slug?: string } | null)?.event_slug
  if (!eventSlug) return

  const offerings = await getIncludedOfferings(db, eventSlug)
  if (offerings.length === 0) return

  const { data: partRows } = await db
    .from('participants')
    .select('member_id, t_shirt_size')
    .eq('registration_id', registrationId)
  const parts = (partRows ?? []) as { member_id: string | null; t_shirt_size: string | null }[]
  if (parts.length === 0) return

  const items: Record<string, unknown>[] = []
  for (const p of parts) {
    for (const off of offerings) {
      const variant = resolveVariantForSize(off.variants, p.t_shirt_size) ?? off.fallbackVariant
      if (!variant) continue
      items.push({
        order_id: orderId,
        variant_id: variant.id,
        sku: variant.sku,
        name: `${off.productName}${variant.label ? ` — ${variant.label}` : ''}`,
        qty: 1,
        unit_amount_cents: 0,
        line_source: 'event_included',
        fulfillment_mode: 'batch',
        fulfillment_status: 'awaiting_batch',
        participant_member_id: p.member_id ?? null,
      })
    }
  }
  if (items.length > 0) await db.from('store_order_items').insert(items)
}

// On confirmation: allocate included shirts, activate paid add-ons, mark the
// event-merch order paid. Idempotent + best-effort (never breaks confirmation).
export async function finalizeRegistrationMerch(db: SupabaseClient, registrationId: string): Promise<void> {
  try {
    const orderId = await ensureEventMerchOrder(db, registrationId)
    if (!orderId) return
    await allocateIncludedShirts(db, registrationId)
    // Pending add-ons are now paid → make them eligible for the bulk batch.
    await db
      .from('store_order_items')
      .update({ fulfillment_status: 'awaiting_batch' })
      .eq('order_id', orderId)
      .eq('line_source', 'event_addon')
      .eq('fulfillment_status', 'pending')
    await db.from('store_orders').update({ status: 'paid' }).eq('id', orderId)
  } catch (err) {
    console.error('[store/event-merch] finalizeRegistrationMerch failed (non-fatal):', err)
    // Every event is Stellr's today, so a failed owner read here leaves a paid registration
    // without its shirts and add-ons: staff see it in the error digest.
    if (err instanceof EventMerchOwnerReadError) await reportError(err, { route: 'LIB store/event-merch owner lookup', db })
  }
}
