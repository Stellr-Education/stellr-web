import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { assertNotImpersonating } from '@/lib/impersonation'
import { getEventBySlug } from '@/lib/events/repo'
import { logRecordAccess } from '@/lib/record-access-log'
import { stripeClient } from '@/lib/stripe'
import { lineIdsOfEvent, loadEventBookings, manifestCsv, refreshOrder, registrationsWithAddons, setLinesChecked, unpaidLines } from '@/lib/addons/admin'
import { bookAddons, loadBookingContext, loadRegistrationForAddons } from '@/lib/addons/booking'
import { cancelAddonLines, cancelParticipantAddons } from '@/lib/addons/cancel'
import { resyncAddonInvoice } from '@/lib/addons/invoice'
import { settleAddonLines } from '@/lib/addons/invoice-items'
import { sendAddonPayLinks } from '@/lib/addons/notify'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

const ROUTE = '/api/admin/events/[slug]/addons/bookings'

// Staff and event managers on an event's add-on bookings (docs/PLAN-event-add-ons-2026-11-17.md,
// Phase 5: US-4, US-6, US-7, US-23). Stellr's events only. Every change is audited; an
// export is also logged in record_access_log.
//   GET    — every line (JSON), or ?format=csv&addonId= for one add-on's manifest
//   POST   — book for anyone: { registrationId, items, payer, groupMethod?, overrideMinorRule? }
//   PATCH  — { lineIds, action: waive | mark_paid_offline | check_in | undo_check_in }
//   DELETE — { lineIds, refund } cancels lines; { cancelAll: true } cancels and refunds every
//            add-on line of the event (the event is cancelled)

async function crewFor(req: Request | null, slug: string) {
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return { ok: false as const, res: crew.response }
  if (req) noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return { ok: false as const, res: foreign }
  return { ok: true as const, crew, db: stellrOnlyDb(crew.scope, supabaseServer()) }
}

// An export of personal data is audited (and in record_access_log), like the roster CSV.
export const GET = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'export.addon_manifest', ...auditSubject(req, 'registration_addons') }),
  list,
)

async function list(req: Request, { params }: Ctx) {
  const { slug } = await params
  const c = await crewFor(req, slug)
  if (!c.ok) return c.res
  const url = new URL(req.url)
  // ?registrationId= : that registration's people, for booking on their behalf.
  const regParam = url.searchParams.get('registrationId')
  if (regParam) {
    const registration = /^[0-9a-f-]{36}$/i.test(regParam) ? await loadRegistrationForAddons(c.db, regParam) : null
    if (!registration || registration.event_slug !== slug) return NextResponse.json({ error: 'Registration not found for this event' }, { status: 404 })
    const ctx = await loadBookingContext(c.db, registration)
    return NextResponse.json({
      registration: { id: registration.id, type: registration.type },
      participants: ctx.participants.map((p) => ({ id: p.id, firstName: p.first_name, lastName: p.last_name })),
    })
  }
  const lines = await loadEventBookings(c.db, slug)
  if (url.searchParams.get('format') === 'csv') {
    const addonId = url.searchParams.get('addonId')
    const chosen = lines.filter((l) => l.addonId === addonId)
    const event = await getEventBySlug(slug).catch(() => null)
    const csv = manifestCsv(chosen, (event as { date?: string } | null)?.date ?? null)
    await logRecordAccess({ action: 'export', route: ROUTE, eventSlug: slug, rowCount: chosen.length, detail: { kind: 'addon_manifest', addonId: addonId ?? '' } })
    const title = (chosen[0]?.addonTitle ?? 'add-on').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}-${title}.csv"`, 'Cache-Control': 'no-store' },
    })
  }
  return NextResponse.json({
    lines: lines.map(({ dateOfBirth: _dob, ...l }) => l),
  })
}

const bookSchema = z.object({
  registrationId: z.string().uuid(),
  items: z.array(z.object({ addonId: z.string().uuid(), participantIds: z.array(z.string().uuid()).min(1).max(200), variantId: z.string().uuid().nullable().optional(), quantity: z.number().int().min(1).max(100).optional() })).min(1).max(50),
  payer: z.enum(['group', 'self', 'included', 'offline']),
  groupMethod: z.enum(['card', 'invoice']).nullable().optional(),
  overrideMinorRule: z.boolean().optional(),
})

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_addon.booking.create', ...auditSubject(req, 'registration_addons') }),
  book,
)

async function book(req: Request, { params }: Ctx) {
  const { slug } = await params
  const c = await crewFor(req, slug)
  if (!c.ok) return c.res
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const parsed = bookSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose the registration, extras, people and payer.' }, { status: 400 })
  const registration = await loadRegistrationForAddons(c.db, parsed.data.registrationId)
  if (!registration || registration.event_slug !== slug) return NextResponse.json({ error: 'Registration not found for this event' }, { status: 404 })
  noteAuditSubject(req, { id: registration.id, detail: { payer: parsed.data.payer, override: !!parsed.data.overrideMinorRule } })

  const ctx = await loadBookingContext(c.db, registration)
  const event = await getEventBySlug(slug).catch(() => null)
  const eventDate = (event as { date?: string } | null)?.date ?? null
  const result = await bookAddons(c.db, ctx, { kind: 'staff' }, parsed.data, { bookedByMemberId: null, eventDate, actorLabel: `staff:${c.crew.userId}` })
  if (!result.ok) return NextResponse.json({ error: result.refusals[0]?.message, refusals: result.refusals }, { status: result.status })
  if (parsed.data.payer === 'group' && parsed.data.groupMethod === 'invoice') await resyncAddonInvoice(c.db, registration.id)
  const linksSent = await sendAddonPayLinks(c.db, {
    eventSlug: slug, eventTitle: registration.event_title ?? 'your event', eventDate, bookedBy: 'Stellr Education', participants: ctx.participants, orders: result.orders,
  })
  return NextResponse.json({ ok: true, booked: result.lineIds.length, linksSent })
}

const patchSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['waive', 'mark_paid_offline', 'check_in', 'undo_check_in']),
})

export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_addon.booking.update', ...auditSubject(req, 'registration_addons') }),
  update,
)

async function update(req: Request, { params }: Ctx) {
  const { slug } = await params
  const c = await crewFor(req, slug)
  if (!c.ok) return c.res
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose the lines and what to do.' }, { status: 400 })
  const ids = await lineIdsOfEvent(c.db, slug, parsed.data.lineIds)
  if (ids.length !== parsed.data.lineIds.length) return NextResponse.json({ error: 'Some of those bookings aren’t on this event.' }, { status: 404 })
  noteAuditSubject(req, { detail: { desk_action: parsed.data.action, count: ids.length } })
  const { action } = parsed.data

  if (action === 'check_in' || action === 'undo_check_in') {
    await setLinesChecked(c.db, ids, action === 'check_in')
    return NextResponse.json({ ok: true })
  }
  // Waive or mark paid offline: unpaid lines leave their order or invoice, then settle.
  const rows = await unpaidLines(c.db, ids)
  const now = new Date().toISOString()
  const settled = await settleAddonLines(
    c.db,
    rows.map((r) => r.id),
    action === 'waive' ? null : now,
    action === 'waive' ? { payer: 'included', group_method: null, unit_price_cents: 0, order_id: null } : { payer: 'offline', group_method: null, order_id: null },
  )
  for (const orderId of new Set(rows.map((r) => r.order_id).filter((o): o is string => !!o))) await refreshOrder(c.db, orderId)
  for (const regId of new Set(rows.filter((r) => r.payer === 'group' && r.group_method === 'invoice').map((r) => r.registration_id))) await resyncAddonInvoice(c.db, regId)
  return NextResponse.json({ ok: true, settled })
}

const deleteSchema = z.union([
  z.object({ lineIds: z.array(z.string().uuid()).min(1).max(500), refund: z.boolean().default(true) }),
  z.object({ cancelAll: z.literal(true) }),
])

export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_addon.booking.cancel', ...auditSubject(req, 'registration_addons') }),
  cancel,
)

async function cancel(req: Request, { params }: Ctx) {
  const { slug } = await params
  const c = await crewFor(req, slug)
  if (!c.ok) return c.res
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose the bookings to cancel.' }, { status: 400 })
  const stripe = stripeClient()
  const onInvoiceChanged = (regId: string) => resyncAddonInvoice(c.db, regId)
  if ('cancelAll' in parsed.data) {
    noteAuditSubject(req, { detail: { cancel_all: true } })
    const regIds = await registrationsWithAddons(c.db, slug)
    const out = []
    for (const regId of regIds) {
      out.push(...(await cancelParticipantAddons(c.db, stripe, { registrationId: regId }, { reason: 'event_cancelled', actorMemberId: null, onInvoiceChanged })))
    }
    return NextResponse.json({ ok: true, cancelled: out })
  }
  const ids = await lineIdsOfEvent(c.db, slug, parsed.data.lineIds)
  if (ids.length !== parsed.data.lineIds.length) return NextResponse.json({ error: 'Some of those bookings aren’t on this event.' }, { status: 404 })
  noteAuditSubject(req, { detail: { count: ids.length, refund: parsed.data.refund } })
  const out = await cancelAddonLines(c.db, stripe, ids, { reason: 'staff', actorMemberId: null, refund: parsed.data.refund, onInvoiceChanged })
  return NextResponse.json({ ok: true, cancelled: out })
}
