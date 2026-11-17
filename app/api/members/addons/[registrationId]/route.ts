import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { withAudit } from '@/lib/audit/route'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rowTenant } from '@/lib/registration/event-context'
import { teamAudit, TEAM_ADDON_BOOK_AUDIT } from '@/lib/registration/team-audit'
import { getEventBySlug } from '@/lib/events/repo'
import { sendEmail } from '@/lib/email'
import { stripeClient } from '@/lib/stripe'
import { reportError } from '@/lib/app-errors'
import { actorFor, memberForClerkUser } from '@/lib/addons/access'
import { addonPayPageUrl, bookAddons, loadBookingContext, loadOrderByToken, loadOrderLines, loadRegistrationForAddons } from '@/lib/addons/booking'
import { createAddonCheckout } from '@/lib/addons/checkout'
import { addonPayLinkEmail } from '@/lib/addons/emails'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { LIVE_LINE_STATUSES } from '@/lib/addons/types'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const GUARDIAN = /parent|guardian|mother|father|mom|dad|mum/i

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
  // Invoices for add-ons arrive with Phase 3.
  if (parsed.data.payer === 'group' && parsed.data.groupMethod === 'invoice' && !process.env.ADDONS_INVOICE_ENABLED) {
    return NextResponse.json({ error: 'Paying for extras by invoice isn’t available yet. Choose card or “each person pays”.' }, { status: 400 })
  }

  const ctx = await loadBookingContext(db, registration)
  const event = await getEventBySlug(registration.event_slug).catch(() => null)
  const eventDate = (event as { date?: string } | null)?.date ?? null
  const eventTitle = registration.event_title ?? (event as { title?: string } | null)?.title ?? 'your event'
  const organiserName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Your group’s organizer'

  const result = await bookAddons(db, ctx, actor, parsed.data, { bookedByMemberId: member.id, eventDate, actorLabel: `member:${member.id}` })
  if (!result.ok) return NextResponse.json({ error: result.refusals[0]?.message ?? 'Those extras couldn’t be booked.', refusals: result.refusals }, { status: result.status })

  const back = `${SITE_URL}/account/extras/${registration.id}`
  let checkoutUrl: string | null = null
  const linksSent: string[] = []
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
    // "Each person pays": email that person (and a parent or guardian on file, for a minor) their link.
    const person = ctx.participants.find((x) => x.id === order.participantId)
    if (!person?.email) continue
    try {
      const lines = await loadOrderLines(db, order.id)
      const msg = addonPayLinkEmail({
        firstName: person.first_name,
        eventTitle,
        lines: lines.map((l) => ({ title: l.title, firstName: l.firstName, quantity: l.quantity, unitPriceCents: l.unitPriceCents, currency: l.currency })),
        totalCents: order.totalCents,
        currency: lines[0]?.currency ?? 'usd',
        payUrl: addonPayPageUrl(registration.event_slug, order.payToken!),
        closesAt: lines.map((l) => l.saleClosesAt).filter((d): d is string => !!d).sort()[0] ?? null,
        bookedBy: organiserName,
      })
      const guardian =
        isRegistrationMinor(person.date_of_birth, eventDate) && person.emergency_contact_email && GUARDIAN.test(person.emergency_contact_relationship ?? '')
          ? [person.emergency_contact_email]
          : []
      await sendEmail({ to: person.email, cc: guardian.length ? guardian : undefined, subject: msg.subject, html: msg.html, text: msg.text })
      linksSent.push(person.first_name)
    } catch (e) {
      await reportError(e, { route: 'API members/addons pay link', db })
    }
  }
  return NextResponse.json({ ok: true, checkoutUrl, linksSent, booked: result.lineIds.length })
}
