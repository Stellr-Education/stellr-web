import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { hasCapability, requireEventCrew, requireEventRoute } from '@/lib/authz'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { refuseOutsideStellr, stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { withAudit } from '@/lib/audit/route'
import { actorFromAuth } from '@/lib/activity-log'
import { assignEventManager, removeEventManager, expiryTimestampToDate, isAssignmentActive, listEventManagerAssignments } from '@/lib/event-manager'

const ROUTE = '/api/admin/event-managers'

// Admin-only management of Event Manager → event assignments, from an event's
// Overview panel. Event Managers cannot manage assignments, only admins.
//
// S5 wave 9, C21: tenant_crew, Stellr-only for other tenants. Each handler asks its
// capability first (portal:read to list, event_managers:assign to change, which no event
// manager holds), then lib/authz, and then the Stellr-only option. The list asks
// requireEventCrew, as it may span every event: a tenant's staff get refuseOutsideStellr's
// 503, and it holds Stellr's rows only, so another tenant's event lists as empty, as an
// unknown one does. A change names its event, so it asks requireEventRoute for it and then
// stellrOnlyEvent: another tenant's event answers 404 for everyone, a Stellr admin
// included, as a slug nobody knows does. An assignment sets the person's Clerk role and
// their one Stellr event_manager membership, so who may grant one in another tenant waits
// for the owner; until then nothing changes for Stellr.
//
// POST and DELETE go through lib/event-manager, the same as the member page
// (Classification → Event Manager), so the clearance gate, expiry, Clerk role,
// activity log and email are identical whichever screen an admin uses.

// What this request acted on, which withAudit's spec cannot read for itself. The target is
// their Clerk id: an email typed into the request stays out of the event.
const audited = new WeakMap<Request, { userId: string | null; eventSlug: string; clerkUserId: string }>()

function eventFor(req: Request) {
  const a = audited.get(req)
  return {
    actor: a ? { userId: a.userId } : { session: true as const },
    tenant: { stellr: true as const },
    target: { table: 'event_manager_assignments', id: a?.clerkUserId ?? null },
    metadata: { eventSlug: a?.eventSlug ?? null },
  }
}

// GET /api/admin/event-managers?event_slug=... — list assignments (optionally per event)
export async function GET(req: Request) {
  if (!(await hasCapability('portal:read', { route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })

  const outside = refuseOutsideStellr(crew.scope)
  if (outside) return outside
  const eventSlug = new URL(req.url).searchParams.get('event_slug')
  if (eventSlug && !crew.covers(eventSlug)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await listEventManagerAssignments(stellrOnlyDb(crew.scope, supabaseServer()), eventSlug)
  if (error) {
    console.error('Event manager assignments fetch error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  const now = new Date()
  return NextResponse.json({
    assignments: (data ?? []).map((r) => ({
      ...r,
      expires_on: r.expires_at ? expiryTimestampToDate(r.expires_at) : null,
      active: isAssignmentActive(r, now),
    })),
  })
}

// POST /api/admin/event-managers — assign a manager
// Body: { event_slug, expires_on? } plus either { clerk_user_id } or { email } (resolved via Clerk).
export const POST = withAudit(({ args: [req] }: { args: [Request] }) => ({ action: 'event_manager.assignment.create', ...eventFor(req) }), assignManager)

async function assignManager(req: Request) {
  if (!(await hasCapability('event_managers:assign', { route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await auth()

  const body = await req.json().catch(() => null)
  let clerkUserId = typeof body?.clerk_user_id === 'string' ? body.clerk_user_id.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const eventSlug = typeof body?.event_slug === 'string' ? body.event_slug.trim() : ''
  const expiresOn = typeof body?.expires_on === 'string' && body.expires_on ? body.expires_on : null
  if ((!clerkUserId && !email) || !eventSlug) {
    return NextResponse.json({ error: 'event_slug and clerk_user_id or email are required' }, { status: 400 })
  }
  // Before an account is looked up, so another tenant's event is refused having asked Clerk nothing.
  const crew = await requireEventRoute(eventSlug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), eventSlug, ROUTE)
  if (foreign) return foreign

  if (!clerkUserId) {
    const client = await clerkClient()
    const { data: users } = await client.users.getUserList({ emailAddress: [email] })
    if (users.length === 0) {
      return NextResponse.json({ error: `No account found for ${email}` }, { status: 404 })
    }
    clerkUserId = users[0].id
  }
  audited.set(req, { userId, eventSlug, clerkUserId })

  const result = await assignEventManager(stellrOnlyDb(crew.scope, supabaseServer()), {
    member: { clerkUserId },
    eventSlug,
    expiresOn,
    actor: await actorFromAuth(),
    routePath: ROUTE,
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json(
    { assignment: { clerk_user_id: clerkUserId, event_slug: result.eventSlug, expires_on: result.expiresOn }, warnings: result.warnings },
    { status: result.created ? 201 : 200 },
  )
}

// DELETE /api/admin/event-managers — remove an assignment { clerk_user_id, event_slug }
export const DELETE = withAudit(({ args: [req] }: { args: [Request] }) => ({ action: 'event_manager.assignment.delete', ...eventFor(req) }), removeManager)

async function removeManager(req: Request) {
  if (!(await hasCapability('event_managers:assign', { route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await auth()

  const body = await req.json().catch(() => null)
  const clerkUserId = typeof body?.clerk_user_id === 'string' ? body.clerk_user_id.trim() : ''
  const eventSlug = typeof body?.event_slug === 'string' ? body.event_slug.trim() : ''
  if (!clerkUserId || !eventSlug) {
    return NextResponse.json({ error: 'clerk_user_id and event_slug are required' }, { status: 400 })
  }
  const crew = await requireEventRoute(eventSlug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), eventSlug, ROUTE)
  if (foreign) return foreign
  audited.set(req, { userId, eventSlug, clerkUserId })

  const result = await removeEventManager(stellrOnlyDb(crew.scope, supabaseServer()), { clerkUserId, eventSlug, reason: 'admin', actor: await actorFromAuth(), routePath: ROUTE })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}
