// Event add-ons: Stripe Checkout for an add-on order (Phase 2 of
// docs/PLAN-event-add-ons-2026-11-17.md).
//
// One Checkout per order, priced from the database, never from the browser. The
// session's metadata holds ids only (no names or emails: plan defect D4), and the
// webhook re-reads the order and checks the amount before confirming anything
// (lib/addons/fulfil.ts). No promotion codes: discounts never apply to add-ons (Q6, Q7).

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertLiveCredentials } from '@/lib/env-guards'
import { loadOrderLines, type OrderForPayment } from './booking'

export const ADDON_ORDER_METADATA_TYPE = 'addon_order'

export type AddonCheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; status: number; error: string }

interface CheckoutLine {
  name: string
  unitCents: number
  quantity: number
}

/** Stripe line items: one per (add-on, size, price), quantities summed. Names hold no personal data. */
export function checkoutLineItems(
  lines: { title: string; variantLabel: string | null; unitPriceCents: number; quantity: number }[],
): CheckoutLine[] {
  const out = new Map<string, CheckoutLine>()
  for (const l of lines) {
    const name = l.variantLabel ? `${l.title} (${l.variantLabel})` : l.title
    const key = `${name}|${l.unitPriceCents}`
    const cur = out.get(key)
    if (cur) cur.quantity += l.quantity
    else out.set(key, { name, unitCents: l.unitPriceCents, quantity: l.quantity })
  }
  return [...out.values()]
}

export async function createAddonCheckout(
  stripe: Stripe,
  db: SupabaseClient,
  order: OrderForPayment,
  opts: { successUrl: string; cancelUrl: string; customerEmail?: string | null; now?: Date },
): Promise<AddonCheckoutResult> {
  if (order.status === 'paid') return { ok: false, status: 409, error: 'These extras are already paid for.' }
  if (order.status !== 'open') return { ok: false, status: 410, error: 'This payment link is no longer active.' }

  const lines = await loadOrderLines(db, order.id)
  const due = lines.filter((l) => l.status === 'pending_payment')
  if (due.length === 0) return { ok: false, status: 410, error: 'There’s nothing left to pay on this link.' }
  const now = opts.now ?? new Date()
  const closed = due.find((l) => l.saleClosesAt && new Date(l.saleClosesAt).getTime() <= now.getTime())
  if (closed) {
    return { ok: false, status: 410, error: `Bookings for ${closed.title} have closed, so this link can no longer take payment. Contact Stellr if you still need it.` }
  }
  // The order total is what the webhook will check: it must equal what is still due.
  const total = due.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0)
  if (total !== order.total_cents) {
    await db.from('addon_orders').update({ total_cents: total }).eq('id', order.id).eq('status', 'open')
  }
  if (total < 50) return { ok: false, status: 400, error: 'There’s nothing to pay by card on this link.' }

  const variantIds = [...new Set(due.map((l) => l.variantId).filter((v): v is string => !!v))]
  const labels = new Map<string, string>()
  if (variantIds.length) {
    const { data } = await db.from('store_variants').select('id, label').in('id', variantIds)
    for (const v of (data ?? []) as { id: string; label: string | null }[]) labels.set(v.id, v.label ?? '')
  }
  const items = checkoutLineItems(
    due.map((l) => ({ title: l.title, variantLabel: l.variantId ? labels.get(l.variantId) || null : null, unitPriceCents: l.unitPriceCents, quantity: l.quantity })),
  )

  // A previous session for this order would let the same lines be paid twice.
  if (order.stripe_checkout_session_id) {
    try {
      const prev = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)
      if (prev.status === 'complete') return { ok: false, status: 409, error: 'These extras are already paid for.' }
      if (prev.status === 'open') await stripe.checkout.sessions.expire(prev.id)
    } catch {
      // A session Stripe no longer knows is no session.
    }
  }

  assertLiveCredentials('stripe')
  const metadata = { type: ADDON_ORDER_METADATA_TYPE, orderId: order.id }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: items.map((i) => ({
      quantity: i.quantity,
      price_data: { currency: order.currency, unit_amount: i.unitCents, product_data: { name: i.name } },
    })),
    ...(opts.customerEmail ? { customer_email: opts.customerEmail } : {}),
    client_reference_id: order.id,
    metadata,
    payment_intent_data: { metadata },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  })
  if (!session.url) throw new Error('Stripe add-on checkout session has no URL')
  await db.from('addon_orders').update({ stripe_checkout_session_id: session.id }).eq('id', order.id)
  return { ok: true, url: session.url, sessionId: session.id }
}
