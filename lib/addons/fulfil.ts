// Event add-ons: settling a paid add-on order from the Stripe webhook (Phase 2 of
// docs/PLAN-event-add-ons-2026-11-17.md).
//
// The session's metadata names only the order. Everything else is re-read here and
// checked: the amount and currency must equal the order's, or nothing is confirmed
// and staff are alerted (NFR-2). Idempotent: a second delivery finds the order paid.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/app-errors'
import { assertLiveCredentials } from '@/lib/env-guards'
import { sendEmail } from '@/lib/email'
import { getEventBySlug } from '@/lib/events/repo'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { ensureEventMerchOrder } from '@/lib/store/event-merch'
import { addendumSignedFor, settledStatus } from './consent'
import { addonPaidEmail, type EmailLine } from './emails'

const ROUTE = 'LIB addons/fulfil'

export type FulfilOutcome = 'paid' | 'already_paid' | 'not_found' | 'unpaid' | 'mismatch'

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

export async function fulfilAddonOrder(db: SupabaseClient, session: Stripe.Checkout.Session, stripe?: Stripe | null): Promise<FulfilOutcome> {
  const orderId = session.metadata?.orderId
  if (!orderId) return 'not_found'
  const { data: order } = await db
    .from('addon_orders')
    .select('id, event_slug, registration_id, payer_kind, payer_participant_id, status, total_cents, currency')
    .eq('id', orderId)
    .maybeSingle()
  const o = order as {
    id: string; event_slug: string; registration_id: string | null; payer_kind: string; payer_participant_id: string | null
    status: string; total_cents: number; currency: string
  } | null
  if (!o) {
    await reportError(new Error(`add-on order ${orderId} paid but not found`), { route: ROUTE, db })
    return 'not_found'
  }
  if (o.status === 'paid') return 'already_paid'
  if (session.payment_status !== 'paid') return 'unpaid'
  if ((session.currency ?? '').toLowerCase() !== o.currency.toLowerCase() || session.amount_total !== o.total_cents) {
    await reportError(
      new Error(`add-on order ${o.id}: Stripe took ${session.amount_total} ${session.currency}, the order is ${o.total_cents} ${o.currency}; nothing confirmed`),
      { route: ROUTE, db },
    )
    return 'mismatch'
  }

  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null)
  const paidAt = new Date().toISOString()
  // Conditional on still open, so two deliveries can't both settle it.
  const { data: won } = await db
    .from('addon_orders')
    .update({ status: 'paid', paid_at: paidAt, stripe_payment_intent_id: paymentIntent, stripe_checkout_session_id: session.id })
    .eq('id', o.id)
    .eq('status', 'open')
    .select('id')
  if (!won || (won as unknown[]).length === 0) return 'already_paid'

  const { data: lineRows } = await db
    .from('registration_addons')
    .select('id, status, participant_id, registration_id, variant_id, quantity, unit_price_cents, currency, addon:event_addons(id, title, kind, requires_addendum), participant:participants(first_name, date_of_birth, member_id)')
    .eq('order_id', o.id)
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    status: r.status as string,
    participantId: r.participant_id as string,
    registrationId: r.registration_id as string,
    variantId: (r.variant_id as string | null) ?? null,
    quantity: r.quantity as number,
    unitPriceCents: r.unit_price_cents as number,
    currency: r.currency as string,
    addon: arr(r.addon as unknown) as { id: string; title: string; kind: string; requires_addendum: boolean } | undefined,
    participant: arr(r.participant as unknown) as { first_name: string; date_of_birth: string | null; member_id: string | null } | undefined,
  }))

  const event = await getEventBySlug(o.event_slug).catch(() => null)
  const eventDate = (event as { date?: string } | null)?.date ?? null
  const eventTitle = (event as { title?: string } | null)?.title ?? 'your event'
  const signed = await addendumSignedFor(db, [...new Set(lines.map((l) => l.participantId))])

  const awaitingConsent: string[] = []
  for (const l of lines) {
    if (l.status !== 'pending_payment') {
      // Released at the cut-off (or cancelled) before the payment landed: the money goes back.
      await refundLatePayment(db, stripe ?? null, l, paymentIntent, o.id)
      continue
    }
    const needs = !!l.addon?.requires_addendum && isRegistrationMinor(l.participant?.date_of_birth ?? null, eventDate)
    const status = settledStatus(needs, signed.has(l.participantId))
    if (status === 'pending_consent' && l.participant?.first_name) awaitingConsent.push(l.participant.first_name)
    await db.from('registration_addons').update({ status, paid_at: paidAt }).eq('id', l.id).eq('status', 'pending_payment')
    if (l.addon?.kind === 'merch' && l.variantId) await addMerchItem(db, l)
  }

  await sendReceipt(db, o, lines, eventTitle, awaitingConsent).catch((e) => reportError(e, { route: `${ROUTE} receipt`, db }))
  return 'paid'
}

/** A line paid after it was released or cancelled: refund its amount on this payment (idempotent). */
async function refundLatePayment(
  db: SupabaseClient,
  stripe: Stripe | null,
  l: { id: string; participantId: string; registrationId: string; quantity: number; unitPriceCents: number; currency: string; addon?: { title: string } },
  paymentIntent: string | null,
  orderId: string,
) {
  const cents = l.unitPriceCents * l.quantity
  try {
    if (!stripe || !paymentIntent) throw new Error('no Stripe payment to refund on')
    assertLiveCredentials('stripe')
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntent, amount: cents, metadata: { source: 'stellr_app', reason: 'addon_paid_after_release', addonLineId: l.id } },
      { idempotencyKey: `addon-late-refund-${l.id}` },
    )
    await db.from('event_refunds').insert({
      participant_id: l.participantId, registration_id: l.registrationId, paid_cents: cents, refund_type: 'cash', refund_cents: cents,
      stripe_refund_id: refund.id, source: 'admin', kind: 'addon', addon_line_id: l.id, currency: l.currency,
      note: `${l.addon?.title ?? 'Extra'} was paid after it was released; refunded`,
    })
  } catch (e) {
    await reportError(new Error(`add-on line ${l.id} was paid (order ${orderId}) after it was released, and the refund failed (${e instanceof Error ? e.message : e}); refund it by hand`), { route: ROUTE, db })
  }
}

/** A paid merch line joins the registration's event-merch order, ready for the event's bulk batch. */
async function addMerchItem(
  db: SupabaseClient,
  l: { id: string; registrationId: string; variantId: string | null; quantity: number; unitPriceCents: number; addon?: { title: string }; participant?: { member_id: string | null } },
) {
  try {
    const orderId = await ensureEventMerchOrder(db, l.registrationId)
    if (!orderId || !l.variantId) return
    const { data: v } = await db.from('store_variants').select('sku, label').eq('id', l.variantId).maybeSingle()
    const variant = v as { sku: string; label: string | null } | null
    const { data: item } = await db
      .from('store_order_items')
      .insert({
        order_id: orderId,
        variant_id: l.variantId,
        sku: variant?.sku ?? '',
        name: `${l.addon?.title ?? 'Event merch'}${variant?.label ? ` — ${variant.label}` : ''}`,
        qty: l.quantity,
        unit_amount_cents: l.unitPriceCents,
        line_source: 'event_addon',
        fulfillment_mode: 'batch',
        fulfillment_status: 'awaiting_batch',
        participant_member_id: l.participant?.member_id ?? null,
      })
      .select('id')
      .single()
    if (item) await db.from('registration_addons').update({ store_order_item_id: (item as { id: string }).id }).eq('id', l.id)
  } catch (e) {
    await reportError(e, { route: `${ROUTE} merch`, db })
  }
}

async function sendReceipt(
  db: SupabaseClient,
  o: { id: string; registration_id: string | null; payer_kind: string; payer_participant_id: string | null; total_cents: number; currency: string },
  lines: { status: string; variantId: string | null; quantity: number; unitPriceCents: number; currency: string; addon?: { title: string }; participant?: { first_name: string } }[],
  eventTitle: string,
  awaitingConsent: string[],
) {
  let to: string | null = null
  let firstName = 'there'
  if (o.payer_kind === 'self' && o.payer_participant_id) {
    const { data } = await db.from('participants').select('email, first_name').eq('id', o.payer_participant_id).maybeSingle()
    to = (data as { email: string | null } | null)?.email ?? null
    firstName = (data as { first_name: string } | null)?.first_name ?? firstName
  } else if (o.registration_id) {
    const { data } = await db.from('registrations').select('teacher_email, teacher_first_name').eq('id', o.registration_id).maybeSingle()
    to = (data as { teacher_email: string | null } | null)?.teacher_email ?? null
    firstName = (data as { teacher_first_name?: string | null } | null)?.teacher_first_name ?? firstName
  }
  if (!to) return
  const emailLines: EmailLine[] = lines.map((l) => ({
    title: l.addon?.title ?? 'Extra',
    firstName: l.participant?.first_name ?? '',
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    currency: l.currency,
  }))
  const msg = addonPaidEmail({ firstName, eventTitle, lines: emailLines, totalCents: o.total_cents, currency: o.currency, awaitingConsent })
  await sendEmail({ to, subject: msg.subject, html: msg.html, text: msg.text })
}
