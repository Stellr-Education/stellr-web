// Event add-ons: cancelling lines and refunding them (Phase 4 of
// docs/PLAN-event-add-ons-2026-11-17.md, US-11, US-22, FR-11, FR-12, Q4, Q8).
//
// One function cancels a person's add-ons whenever they leave: a withdrawal, a
// roster removal, a deletion, staff, or the event being cancelled. Each line is
// handled by how it was paid, and refunded to whoever paid for it, never to "the
// participant":
//
//   unpaid, own link or the organiser's card  -> cancelled; its order shrinks or closes
//   unpaid, on the group's invoice            -> cancelled; the invoice is revised
//   paid by Checkout or a paid invoice        -> refunded on that payment, by the rule
//   waived or paid offline                     -> cancelled; offline is flagged for staff
//
// The rule (Q8): accommodation and experiences are refundable until their refund
// date (or sales cut-off); "event policy" follows the 45-day guarantee; merch until
// the event's merch order is committed. An organiser cancelling the event refunds
// everything. Runs before the participant row goes (a delete cascades the lines).

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertLiveCredentials } from '@/lib/env-guards'
import { reportError } from '@/lib/app-errors'
import { GUARANTEE_DAYS, daysSincePayment } from '@/lib/refunds/policy'
import { refundableNow } from './rules'
import { LIVE_LINE_STATUSES, type AddonRow } from './types'

export type CancelReason = 'withdrawn' | 'removed' | 'deleted' | 'staff' | 'member' | 'event_cancelled' | 'released'

export interface CancelledLine {
  lineId: string
  outcome: 'cancelled' | 'refunded' | 'not_refundable' | 'manual_required'
  refundCents: number
}

interface LineForCancel {
  id: string
  registration_id: string
  participant_id: string
  status: string
  payer: string
  group_method: string | null
  quantity: number
  unit_price_cents: number
  currency: string
  paid_at: string | null
  order_id: string | null
  group_invoice_id: string | null
  store_order_item_id: string | null
  addon: Pick<AddonRow, 'id' | 'event_slug' | 'kind' | 'title' | 'refund_rule' | 'refund_until' | 'sale_closes_at'> | null
}

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

const LINE_SELECT =
  'id, registration_id, participant_id, status, payer, group_method, quantity, unit_price_cents, currency, paid_at, order_id, group_invoice_id, store_order_item_id, addon:event_addons(id, event_slug, kind, title, refund_rule, refund_until, sale_closes_at)'

function asLine(r: Record<string, unknown>): LineForCancel {
  return { ...(r as unknown as LineForCancel), addon: (arr(r.addon as unknown) as LineForCancel['addon']) ?? null }
}

/** Is a paid line refundable now, by its add-on's rule (and, for merch, its order item)? Pure. */
export function lineRefundable(
  line: Pick<LineForCancel, 'paid_at'> & { addon: LineForCancel['addon'] },
  opts: { reason: CancelReason; merchCommitted: boolean; now?: Date },
): boolean {
  if (opts.reason === 'event_cancelled') return true
  if (!line.addon) return false
  if (line.addon.kind === 'merch') return !opts.merchCommitted
  const rule = refundableNow(line.addon, opts.now)
  if (rule === 'event_policy') return !!line.paid_at && daysSincePayment(new Date(line.paid_at), opts.now) <= GUARANTEE_DAYS
  return rule
}

/** Cancel every live add-on line of these participants (or of a whole registration). */
export async function cancelParticipantAddons(
  db: SupabaseClient,
  stripe: Stripe | null,
  target: { participantIds?: string[]; registrationId?: string },
  opts: { reason: CancelReason; actorMemberId: string | null; refund?: boolean; onInvoiceChanged?: (registrationId: string) => Promise<void> },
): Promise<CancelledLine[]> {
  let q = db.from('registration_addons').select(LINE_SELECT).in('status', [...LIVE_LINE_STATUSES])
  if (target.participantIds?.length) q = q.in('participant_id', target.participantIds)
  else if (target.registrationId) q = q.eq('registration_id', target.registrationId)
  else return []
  const { data, error } = await q
  if (error) throw new Error(`add-on lines: ${error.message}`)
  return cancelLines(db, stripe, ((data ?? []) as Record<string, unknown>[]).map(asLine), opts)
}

/** Cancel specific lines by id (staff, a member cancelling one extra, the cut-off sweep). */
export async function cancelAddonLines(
  db: SupabaseClient,
  stripe: Stripe | null,
  lineIds: string[],
  opts: { reason: CancelReason; actorMemberId: string | null; refund?: boolean; onInvoiceChanged?: (registrationId: string) => Promise<void> },
): Promise<CancelledLine[]> {
  if (lineIds.length === 0) return []
  const { data, error } = await db.from('registration_addons').select(LINE_SELECT).in('id', lineIds).in('status', [...LIVE_LINE_STATUSES])
  if (error) throw new Error(`add-on lines: ${error.message}`)
  return cancelLines(db, stripe, ((data ?? []) as Record<string, unknown>[]).map(asLine), opts)
}

async function cancelLines(
  db: SupabaseClient,
  stripe: Stripe | null,
  lines: LineForCancel[],
  opts: { reason: CancelReason; actorMemberId: string | null; refund?: boolean; onInvoiceChanged?: (registrationId: string) => Promise<void> },
): Promise<CancelledLine[]> {
  const out: CancelledLine[] = []
  const now = new Date().toISOString()
  const touchedOrders = new Set<string>()
  const invoiceRegs = new Set<string>()
  const cancel = async (l: LineForCancel, status: 'cancelled' | 'expired' | 'refunded') => {
    await db.from('registration_addons').update({ status, cancelled_at: now, cancel_reason: opts.reason }).eq('id', l.id)
    if (l.store_order_item_id) {
      await db.from('store_order_items').update({ fulfillment_status: 'cancelled' }).eq('id', l.store_order_item_id).in('fulfillment_status', ['pending', 'awaiting_batch'])
    }
  }

  for (const l of lines) {
    const amount = l.unit_price_cents * l.quantity
    const unpaid = l.status === 'pending_payment'
    try {
      if (unpaid) {
        await cancel(l, opts.reason === 'released' ? 'expired' : 'cancelled')
        if (l.order_id) touchedOrders.add(l.order_id)
        if (l.payer === 'group' && l.group_method === 'invoice') invoiceRegs.add(l.registration_id)
        out.push({ lineId: l.id, outcome: 'cancelled', refundCents: 0 })
        continue
      }
      // Settled: waived or offline need no refund here (offline is staff's to settle).
      if (l.payer === 'included' || amount === 0) {
        await cancel(l, 'cancelled')
        out.push({ lineId: l.id, outcome: 'cancelled', refundCents: 0 })
        continue
      }
      if (l.payer === 'offline') {
        await cancel(l, 'cancelled')
        await recordRefund(db, l, { type: 'manual_required', cents: amount, note: 'Paid offline: refund by hand if due', actor: opts.actorMemberId })
        out.push({ lineId: l.id, outcome: 'manual_required', refundCents: amount })
        continue
      }
      const merchCommitted = await merchIsCommitted(db, l)
      const refundable = opts.refund !== false && lineRefundable(l, { reason: opts.reason, merchCommitted })
      if (!refundable) {
        await cancel(l, 'cancelled')
        await recordRefund(db, l, { type: 'none', cents: 0, note: 'Past this extra’s refund date', actor: opts.actorMemberId })
        out.push({ lineId: l.id, outcome: 'not_refundable', refundCents: 0 })
        continue
      }
      const intent = await paymentIntentFor(db, l)
      if (!stripe || !intent) {
        await cancel(l, 'cancelled')
        await recordRefund(db, l, { type: 'manual_required', cents: amount, note: 'No card payment to refund automatically', actor: opts.actorMemberId })
        out.push({ lineId: l.id, outcome: 'manual_required', refundCents: amount })
        continue
      }
      assertLiveCredentials('stripe')
      const refund = await stripe.refunds.create(
        { payment_intent: intent, amount, metadata: { source: 'stellr_app', reason: `addon_${opts.reason}`, addonLineId: l.id } },
        { idempotencyKey: `addon-refund-${l.id}` },
      )
      await cancel(l, 'refunded')
      await recordRefund(db, l, { type: 'cash', cents: amount, stripeRefundId: refund.id, actor: opts.actorMemberId })
      out.push({ lineId: l.id, outcome: 'refunded', refundCents: amount })
    } catch (e) {
      await reportError(e, { route: 'LIB addons/cancel', db })
      await recordRefund(db, l, { type: 'manual_required', cents: amount, note: 'The automatic refund failed; refund by hand', actor: opts.actorMemberId }).catch(() => {})
      out.push({ lineId: l.id, outcome: 'manual_required', refundCents: amount })
    }
  }

  for (const orderId of touchedOrders) await shrinkOrder(db, stripe, orderId)
  for (const regId of invoiceRegs) {
    if (opts.onInvoiceChanged) await opts.onInvoiceChanged(regId).catch((e) => reportError(e, { route: 'LIB addons/cancel invoice', db }))
  }
  return out
}

/** The payment a paid line came from: its order's Checkout, or the group invoice it was on. */
async function paymentIntentFor(db: SupabaseClient, l: LineForCancel): Promise<string | null> {
  if (l.order_id) {
    const { data } = await db.from('addon_orders').select('stripe_payment_intent_id, status').eq('id', l.order_id).maybeSingle()
    const o = data as { stripe_payment_intent_id: string | null; status: string } | null
    if (o?.status === 'paid' && o.stripe_payment_intent_id) return o.stripe_payment_intent_id
  }
  if (l.group_invoice_id) {
    const { data } = await db.from('group_invoices').select('payment_intent_id, status').eq('id', l.group_invoice_id).maybeSingle()
    const g = data as { payment_intent_id: string | null; status: string } | null
    if (g?.status === 'paid' && g.payment_intent_id) return g.payment_intent_id
  }
  return null
}

async function merchIsCommitted(db: SupabaseClient, l: LineForCancel): Promise<boolean> {
  if (l.addon?.kind !== 'merch' || !l.store_order_item_id) return false
  const { data } = await db.from('store_order_items').select('fulfillment_status').eq('id', l.store_order_item_id).maybeSingle()
  const s = (data as { fulfillment_status?: string } | null)?.fulfillment_status
  return !!s && !['pending', 'awaiting_batch', 'cancelled'].includes(s)
}

/** An unpaid order losing lines: its total follows, an open Checkout is expired, and an empty one closes. */
async function shrinkOrder(db: SupabaseClient, stripe: Stripe | null, orderId: string) {
  const { data: order } = await db.from('addon_orders').select('id, status, stripe_checkout_session_id').eq('id', orderId).maybeSingle()
  const o = order as { id: string; status: string; stripe_checkout_session_id: string | null } | null
  if (!o || o.status !== 'open') return
  const { data: rest } = await db.from('registration_addons').select('quantity, unit_price_cents').eq('order_id', orderId).eq('status', 'pending_payment')
  const lines = (rest ?? []) as { quantity: number; unit_price_cents: number }[]
  if (o.stripe_checkout_session_id && stripe) {
    try {
      const s = await stripe.checkout.sessions.retrieve(o.stripe_checkout_session_id)
      if (s.status === 'open') await stripe.checkout.sessions.expire(s.id)
    } catch {
      // Already gone.
    }
  }
  if (lines.length === 0) {
    await db.from('addon_orders').update({ status: 'cancelled', stripe_checkout_session_id: null }).eq('id', orderId).eq('status', 'open')
  } else {
    await db.from('addon_orders').update({ total_cents: lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0), stripe_checkout_session_id: null }).eq('id', orderId).eq('status', 'open')
  }
}

async function recordRefund(
  db: SupabaseClient,
  l: LineForCancel,
  r: { type: 'cash' | 'manual_required' | 'none'; cents: number; note?: string; stripeRefundId?: string; actor: string | null },
) {
  const { error } = await db.from('event_refunds').insert({
    participant_id: l.participant_id,
    registration_id: l.registration_id,
    event_slug: l.addon?.event_slug ?? null,
    paid_cents: l.unit_price_cents * l.quantity,
    refund_type: r.type,
    refund_cents: r.cents,
    stripe_refund_id: r.stripeRefundId ?? null,
    decided_by: r.actor,
    source: 'admin',
    kind: 'addon',
    addon_line_id: l.id,
    currency: l.currency,
    note: r.note ?? `${l.addon?.title ?? 'Extra'} cancelled`,
  })
  if (error && !/event_refunds_one_per_addon_line/.test(error.message)) throw new Error(`event_refunds: ${error.message}`)
}
