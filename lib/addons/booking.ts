// Event add-ons: booking lines and the orders that pay for them (Phase 2 of
// docs/PLAN-event-add-ons-2026-11-17.md).
//
// planBooking (lib/addons/plan.ts) decides; this writes. Lines go in through
// book_addon_lines(), one call per add-on, which locks the add-on row and checks
// capacity, so two people can't take the last place. A booking is all or nothing:
// if any add-on is sold out, the lines already written in this request are removed.

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { merchVariants } from './catalog'
import { linesTotal, planBooking, type BookingActor, type BookingRequest, type PlanAddon, type PlannedLine, type Refusal } from './plan'
import { LIVE_LINE_STATUSES, type AddonRow } from './types'

const ADDON_COLUMNS =
  'id, event_slug, kind, title, description, includes, service_date, service_end_date, price_cents, currency, capacity, sale_opens_at, sale_closes_at, audience, refund_rule, refund_until, requires_addendum, minors_group_only, max_per_person, store_product_id, variant_ids, display_group, sort, status'

export interface BookingRegistration {
  id: string
  type: string
  status: string
  event_slug: string
  event_title: string | null
  teacher_member_id: string | null
  teacher_email: string | null
  teacher_poc_email: string | null
  registrant_role: string | null
  tenant_id: string | null
}

export interface BookingParticipant {
  id: string
  first_name: string
  last_name: string
  email: string | null
  event_role: string | null
  date_of_birth: string | null
  member_id: string | null
  emergency_contact_email: string | null
  emergency_contact_relationship: string | null
}

export interface BookingContext {
  registration: BookingRegistration
  participants: BookingParticipant[]
  addons: PlanAddon[]
  lines: AddonLineRow[]
}

export interface AddonLineRow {
  id: string
  participant_id: string
  addon_id: string
  variant_id: string | null
  quantity: number
  unit_price_cents: number
  currency: string
  payer: string
  group_method: string | null
  status: string
  order_id: string | null
  paid_at: string | null
}

const LINE_COLUMNS = 'id, participant_id, addon_id, variant_id, quantity, unit_price_cents, currency, payer, group_method, status, order_id, paid_at'

export async function loadRegistrationForAddons(db: SupabaseClient, registrationId: string): Promise<BookingRegistration | null> {
  const { data } = await db
    .from('registrations')
    .select('id, type, status, event_slug, event_title, teacher_member_id, teacher_email, teacher_poc_email, registrant_role, tenant_id')
    .eq('id', registrationId)
    .maybeSingle()
  return (data as BookingRegistration | null) ?? null
}

export async function loadBookingContext(db: SupabaseClient, registration: BookingRegistration): Promise<BookingContext> {
  const [parts, addonRows, lines] = await Promise.all([
    db
      .from('participants')
      .select('id, first_name, last_name, email, event_role, date_of_birth, member_id, emergency_contact_email, emergency_contact_relationship')
      .eq('registration_id', registration.id)
      .order('created_at'),
    db.from('event_addons').select(ADDON_COLUMNS).eq('event_slug', registration.event_slug).in('status', ['on_sale', 'closed']).order('sort'),
    db.from('registration_addons').select(LINE_COLUMNS).eq('registration_id', registration.id).order('created_at'),
  ])
  if (parts.error) throw new Error(`participants: ${parts.error.message}`)
  if (addonRows.error) throw new Error(`add-ons: ${addonRows.error.message}`)
  if (lines.error) throw new Error(`add-on lines: ${lines.error.message}`)
  const rows = (addonRows.data ?? []) as AddonRow[]
  const variants = await merchVariants(db, registration.event_slug, rows)
  return {
    registration,
    participants: (parts.data ?? []) as BookingParticipant[],
    addons: rows.map((r) => ({ ...r, variants: variants.get(r.id) ?? [] })),
    lines: (lines.data ?? []) as AddonLineRow[],
  }
}

export type BookResult =
  | { ok: true; lineIds: string[]; orders: { id: string; payerKind: 'group' | 'self'; participantId: string | null; totalCents: number; payToken: string | null }[]; total: number }
  | { ok: false; status: number; refusals: Refusal[] }

/**
 * Plan and write a booking. Lines that cost something are grouped into orders:
 * one for the organiser (card), one per person for "each person pays", or one for
 * an individual registrant paying for themselves. Lines on the group's invoice
 * carry no order (Phase 3 bills them). Free, waived and offline lines need none.
 */
export async function bookAddons(
  db: SupabaseClient,
  ctx: BookingContext,
  actor: BookingActor,
  request: BookingRequest,
  opts: { bookedByMemberId: string | null; eventDate: string | null; actorLabel: string },
): Promise<BookResult> {
  const live = ctx.lines.filter((l) => (LIVE_LINE_STATUSES as readonly string[]).includes(l.status))
  const plan = planBooking({
    actor,
    registration: ctx.registration,
    participants: ctx.participants,
    addons: ctx.addons,
    live,
    request,
    eventDate: opts.eventDate,
  })
  if (plan.refusals.length) return { ok: false, status: 422, refusals: plan.refusals }

  const bookedByRole = actor.kind === 'staff' ? 'staff' : actor.kind === 'organiser' ? actor.role : 'self'
  const written: string[] = []
  const byAddon = new Map<string, PlannedLine[]>()
  for (const l of plan.lines) byAddon.set(l.addonId, [...(byAddon.get(l.addonId) ?? []), l])

  for (const [addonId, lines] of byAddon) {
    const { data, error } = await db.rpc('book_addon_lines', {
      p_addon: addonId,
      p_lines: lines.map((l) => ({
        registration_id: ctx.registration.id,
        participant_id: l.participantId,
        variant_id: l.variantId ?? '',
        quantity: l.quantity,
        unit_price_cents: l.unitPriceCents,
        currency: l.currency,
        payer: l.payer,
        group_method: l.groupMethod ?? '',
        status: l.status,
        booked_by_member_id: opts.bookedByMemberId ?? '',
        booked_by_role: bookedByRole,
        minor_rule_override: l.minorRuleOverride,
      })),
    })
    if (error) {
      await removeLines(db, written)
      const title = ctx.addons.find((a) => a.id === addonId)?.title ?? 'That extra'
      if (/addon_sold_out/.test(error.message)) {
        return {
          ok: false,
          status: 409,
          refusals: [{ code: 'addon_sold_out', addonId, message: `${title} doesn’t have enough places left for everyone you chose. Nothing has been booked; try fewer people.` }],
        }
      }
      if (/registration_addons_one_live/.test(error.message)) {
        return { ok: false, status: 409, refusals: [{ code: 'already_booked', addonId, message: `Someone you chose already has ${title}. Nothing has been booked.` }] }
      }
      throw new Error(`book_addon_lines: ${error.message}`)
    }
    for (const r of (data ?? []) as { id: string }[]) written.push(r.id)
  }

  // Pair what was written with the plan, by (participant, add-on, variant).
  const { data: rows } = await db.from('registration_addons').select(LINE_COLUMNS).in('id', written)
  const writtenRows = (rows ?? []) as AddonLineRow[]
  const toPay = writtenRows.filter((r) => r.status === 'pending_payment' && (r.payer === 'self' || (r.payer === 'group' && r.group_method === 'card')))

  const orders: { id: string; payerKind: 'group' | 'self'; participantId: string | null; totalCents: number; payToken: string | null }[] = []
  const groups = new Map<string, AddonLineRow[]>()
  for (const r of toPay) {
    const key = r.payer === 'group' ? 'group' : `self:${r.participant_id}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  for (const [key, ls] of groups) {
    const self = key.startsWith('self:')
    const total = linesTotal(ls.map((l) => ({ unitPriceCents: l.unit_price_cents, quantity: l.quantity })))
    const payToken = randomBytes(32).toString('hex')
    const { data: order, error } = await db
      .from('addon_orders')
      .insert({
        event_slug: ctx.registration.event_slug,
        registration_id: ctx.registration.id,
        payer_kind: self ? 'self' : 'group',
        payer_participant_id: self ? key.slice(5) : null,
        total_cents: total,
        currency: ls[0].currency,
        pay_token: payToken,
        created_by: opts.actorLabel,
      })
      .select('id')
      .single()
    if (error || !order) {
      await removeLines(db, written)
      throw new Error(`addon_orders: ${error?.message ?? 'no row'}`)
    }
    const orderId = (order as { id: string }).id
    await db.from('registration_addons').update({ order_id: orderId }).in('id', ls.map((l) => l.id))
    orders.push({ id: orderId, payerKind: self ? 'self' : 'group', participantId: self ? key.slice(5) : null, totalCents: total, payToken })
  }

  return { ok: true, lineIds: written, orders, total: linesTotal(plan.lines) }
}

/** Undo the lines this request wrote, when a later step fails (all or nothing). */
async function removeLines(db: SupabaseClient, ids: string[]) {
  if (ids.length) await db.from('registration_addons').delete().in('id', ids)
}

/** The pay page for one add-on order. The token is the capability: no account needed (US-19). */
export function addonPayPageUrl(eventSlug: string, token: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  return `${site}/register/${encodeURIComponent(eventSlug)}/addons/pay/${token}`
}

export interface OrderForPayment {
  id: string
  event_slug: string
  registration_id: string | null
  payer_kind: 'group' | 'self'
  payer_participant_id: string | null
  status: string
  total_cents: number
  currency: string
  stripe_checkout_session_id: string | null
  pay_token: string | null
}

export async function loadOrderByToken(db: SupabaseClient, token: string): Promise<OrderForPayment | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const { data } = await db
    .from('addon_orders')
    .select('id, event_slug, registration_id, payer_kind, payer_participant_id, status, total_cents, currency, stripe_checkout_session_id, pay_token')
    .eq('pay_token', token)
    .maybeSingle()
  return (data as OrderForPayment | null) ?? null
}

/** An order's lines with what a pay page shows: the add-on, the person's first name, size, price. */
export async function loadOrderLines(db: SupabaseClient, orderId: string) {
  const { data } = await db
    .from('registration_addons')
    .select('id, status, quantity, unit_price_cents, currency, variant_id, addon:event_addons(id, title, kind, sale_closes_at), participant:participants(first_name)')
    .eq('order_id', orderId)
    .order('created_at')
  const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const addon = arr(r.addon as unknown) as { id: string; title: string; kind: string; sale_closes_at: string | null } | undefined
    const participant = arr(r.participant as unknown) as { first_name: string } | undefined
    return {
      id: r.id as string,
      status: r.status as string,
      quantity: r.quantity as number,
      unitPriceCents: r.unit_price_cents as number,
      currency: r.currency as string,
      variantId: (r.variant_id as string | null) ?? null,
      addonId: addon?.id ?? '',
      title: addon?.title ?? 'Extra',
      kind: addon?.kind ?? 'experience',
      saleClosesAt: addon?.sale_closes_at ?? null,
      firstName: participant?.first_name ?? '',
    }
  })
}
