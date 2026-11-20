import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { withAudit } from '@/lib/audit/route'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rowTenant } from '@/lib/registration/event-context'
import { teamAudit, TEAM_ADDON_BOOK_AUDIT, TEAM_ADDON_CANCEL_AUDIT } from '@/lib/registration/team-audit'
import { cancelAddonLines } from '@/lib/addons/cancel'
import { resyncAddonInvoice } from '@/lib/addons/invoice'
import { getEventBySlug } from '@/lib/events/repo'
import { stripeClient } from '@/lib/stripe'
import { reportError } from '@/lib/app-errors'
import { actorFor, memberForClerkUser } from '@/lib/addons/access'
import { bookAddons, loadBookingContext, loadOrderByToken, loadRegistrationForAddons } from '@/lib/addons/booking'
import { createAddonCheckout } from '@/lib/addons/checkout'
import { syncAddonInvoice } from '@/lib/addons/invoice'
import { markInvoiceSyncDue } from '@/lib/group-billing'
import { sendAddonPayLinks } from '@/lib/addons/notify'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { LIVE_LINE_STATUSES } from '@/lib/addons/types'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

type Ctx = { params: Promise<{ registrationId: string }> }

// The add-ons of one registration, from the member's side (docs/PLAN-event-add-ons-2026-11-17.md, Phase 2).
//   GET  — what this member may book, for whom, and what is already booked
//   POST — book: { items: [{ addonId, participantIds, variantId?, quantity? }], payer, groupMethod? }
// Organisers (teacher, student manager, Teacher POC) book for their group; anyone else on
// the registration books only for themselves. Stellr's events only: another tenant's
// registration answers as missing (plan, "Out of scope").

async function place(registrationId: string) {
  const { userId } = await auth()
  if (!userId) return { ok: false as const, res: NextResponse.json({ error: 'Sign in to add extras.' }, { status: 401 }) }
  const db = supabaseServer()
  const member = await memberForClerkUser(db, userId)
  if (!member) return { ok: false as const, res: NextResponse.json({ error: 'Member not found' }, { status: 404 }) }
  const registration = await loadRegistrationForAddons(db, registrationId)
  const notFound = NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  if (!registration) return { ok: false as const, res: notFound }
  const tenant = rowTenant(registration.tenant_id)
  if (tenant !== (await requestTenant()).tenantId || tenant !== STELLR_TENANT_ID) return { ok: false as const, res: notFound }
  const actor = await actorFor(db, member, registration)
  if (!actor) return { ok: false as const, res: notFound }
  return { ok: true as const, db, userId, member, registration, actor }
}

export async function GET(_req: Request, { params }: Ctx) {
  const { registrationId } = await params
  const p = await place(registrationId)
  if (!p.ok) return p.res
  const { db, registration, actor } = p
  const ctx = await loadBookingContext(db, registration)
  const event = await getEventBySlug(registration.event_slug).catch(() => null)
  const eventDate = (event as { date?: string } | null)?.date ?? null
  const mine = actor.kind === 'member' ? actor.participantId : null
  const visible = (pid: string) => mine == null || pid === mine
  return NextResponse.json({
    registration: { id: registration.id, type: registration.type, status: registration.status, eventSlug: registration.event_slug, eventTitle: registration.event_title },
    actor,
    participants: ctx.participants.filter((x) => visible(x.id)).map((x) => ({
      id: x.id,
      firstName: x.first_name,
      lastName: x.last_name,
      adult: !['participant', 'school_student_manager'].includes(x.event_role ?? 'participant'),
      minor: isRegistrationMinor(x.date_of_birth, eventDate),
    })),
    addons: ctx.addons.map((a) => ({
      id: a.id, kind: a.kind, title: a.title, description: a.description, includes: a.includes,
      serviceDate: a.service_date, priceCents: a.price_cents, currency: a.currency, audience: a.audience,
      minorsGroupOnly: a.minors_group_only, requiresAddendum: a.requires_addendum, maxPerPerson: a.max_per_person,
      saleClosesAt: a.sale_closes_at, status: a.status, variants: a.variants,
    })),
    // Orders the viewer pays: their own link, or the organiser's card order. The token is theirs.
    orders: (await openOrdersFor(db, registration.id))
      .filter((o) => (o.payer_kind === 'self' ? o.payer_participant_id === mine || (mine == null && actor.kind === 'organiser') : actor.kind === 'organiser'))
      .map((o) => ({ id: o.id, payerKind: o.payer_kind, totalCents: o.total_cents, currency: o.currency, payUrl: `/register/${registration.event_slug}/addons/pay/${o.pay_token}` })),
    lines: ctx.lines.filter((l) => visible(l.participant_id)).map((l) => ({
      id: l.id, participantId: l.participant_id, addonId: l.addon_id, variantId: l.variant_id, quantity: l.quantity,
      unitPriceCents: l.unit_price_cents, currency: l.currency, payer: l.payer, groupMethod: l.group_method, status: l.status,
      live: (LIVE_LINE_STATUSES as readonly string[]).includes(l.status),
    })),
  })
}

const bookSchema = z.object({
  items: z
    .array(
      z.object({
        addonId: z.string().uuid(),
        participantIds: z.array(z.string().uuid()).min(1).max(200),
        variantId: z.string().uuid().nullable().optional(),
        quantity: z.number().int().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(50),
  payer: z.enum(['group', 'self']),
  groupMethod: z.enum(['card', 'invoice']).nullable().optional(),
})

export const POST = withAudit(TEAM_ADDON_BOOK_AUDIT, book)

async function book(req: Request, { params }: Ctx) {
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const { registrationId } = await params
  const p = await place(registrationId)
  if (!p.ok) return p.res
  const { db, userId, member, registration, actor } = p
  teamAudit(req, { registrationId, tenantId: STELLR_TENANT_ID, userId })

  const parsed = bookSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose the extras, who they’re for and who pays.' }, { status: 400 })

  const ctx = await loadBookingContext(db, registration)
  const event = await getEventBySlug(registration.event_slug).catch(() => null)
  const eventDate = (event as { date?: string } | null)?.date ?? null
  const eventTitle = registration.event_title ?? (event as { title?: string } | null)?.title ?? 'your event'
  const organiserName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Your group’s organizer'

  const result = await bookAddons(db, ctx, actor, parsed.data, { bookedByMemberId: member.id, eventDate, actorLabel: `member:${member.id}` })
  if (!result.ok) return NextResponse.json({ error: result.refusals[0]?.message ?? 'Those extras couldn’t be booked.', refusals: result.refusals }, { status: result.status })

  // On the group's invoice (US-20): the unpaid invoice is revised, or an add-ons invoice issued.
  let invoiced: string | null = null
  if (parsed.data.payer === 'group' && parsed.data.groupMethod === 'invoice') {
    const stripe = stripeClient()
    if (!stripe) return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
    try {
      const sync = await syncAddonInvoice(db, stripe, registration.id, { memberId: member.id, label: organiserName })
      if (sync === 'busy') await markInvoiceSyncDue(db, registration.id)
      invoiced = sync
    } catch (e) {
      await reportError(e, { route: 'API members/addons invoice', db })
      await markInvoiceSyncDue(db, registration.id)
      invoiced = 'deferred'
    }
  }

  const back = `${SITE_URL}/account/extras/${registration.id}`
  let checkoutUrl: string | null = null
  const stripe = stripeClient()
  for (const order of result.orders) {
    const full = order.payToken ? await loadOrderByToken(db, order.payToken) : null
    if (!full) continue
    // The organiser paying by card, or a member paying for their own: straight to Checkout.
    const payNow = order.payerKind === 'group' || (actor.kind === 'member' && order.participantId === actor.participantId)
    if (payNow) {
      if (!stripe) return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
      const co = await createAddonCheckout(stripe, db, full, {
        successUrl: `${back}?paid=1`,
        cancelUrl: `${back}?cancelled=1`,
        customerEmail: actor.kind === 'organiser' ? member.email : (ctx.participants.find((x) => x.id === order.participantId)?.email ?? member.email),
      })
      if (co.ok) checkoutUrl = co.url
      else return NextResponse.json({ error: co.error }, { status: co.status })
      continue
    }
  }
  // "Each person pays": each person's own link, and a parent or guardian on file for a minor.
  const linksSent = await sendAddonPayLinks(db, {
    eventSlug: registration.event_slug, eventTitle, eventDate, bookedBy: organiserName, participants: ctx.participants,
    orders: result.orders, exceptParticipantId: actor.kind === 'member' ? actor.participantId : null,
  })
  return NextResponse.json({ ok: true, checkoutUrl, linksSent, invoiced, booked: result.lineIds.length })
}

async function openOrdersFor(db: ReturnType<typeof supabaseServer>, registrationId: string) {
  const { data } = await db
    .from('addon_orders')
    .select('id, payer_kind, payer_participant_id, total_cents, currency, pay_token')
    .eq('registration_id', registrationId)
    .eq('status', 'open')
  return (data ?? []) as { id: string; payer_kind: 'group' | 'self'; payer_participant_id: string | null; total_cents: number; currency: string; pay_token: string }[]
}

const cancelSchema = z.object({ lineIds: z.array(z.string().uuid()).min(1).max(100) })

// DELETE — cancel extras: { lineIds }. An organiser cancels any of the group's; anyone else
// only their own. Each line is refunded to whoever paid for it, by its rule (Q8).
export const DELETE = withAudit(TEAM_ADDON_CANCEL_AUDIT, cancelLines)

async function cancelLines(req: Request, { params }: Ctx) {
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const { registrationId } = await params
  const p = await place(registrationId)
  if (!p.ok) return p.res
  const { db, userId, member, registration, actor } = p
  teamAudit(req, { registrationId, tenantId: STELLR_TENANT_ID, userId })
  const parsed = cancelSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose the extras to cancel.' }, { status: 400 })

  const { data } = await db
    .from('registration_addons')
    .select('id, participant_id')
    .eq('registration_id', registration.id)
    .in('id', parsed.data.lineIds)
  const mine = (data ?? []) as { id: string; participant_id: string }[]
  const allowed = mine.filter((l) => actor.kind === 'organiser' || (actor.kind === 'member' && l.participant_id === actor.participantId))
  if (allowed.length !== parsed.data.lineIds.length) return NextResponse.json({ error: 'You can only cancel extras you booked or that are yours.' }, { status: 403 })

  const out = await cancelAddonLines(db, stripeClient(), allowed.map((l) => l.id), {
    reason: actor.kind === 'organiser' ? 'removed' : 'member',
    actorMemberId: member.id,
    onInvoiceChanged: (regId) => resyncAddonInvoice(db, regId),
  })
  return NextResponse.json({ ok: true, cancelled: out })
}
