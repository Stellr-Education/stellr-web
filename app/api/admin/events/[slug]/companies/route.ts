import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import {
  errorCodeOf,
  findEventCompany,
  findEventParticipant,
  loadEventCompanies,
  moveEventParticipant,
  renameEventCompany,
  setEventCompanyCount,
  teamProfileSubmittedAt,
} from '@/lib/events/admin-config'
import { AssignError } from '@/lib/team-profile/assign'
import {
  autoAssignEvent,
  overrideOutstandingEvent,
  overrideParticipant,
  teamProfilesOnTenantPath,
} from '@/lib/team-profile/admin-data'
import { CLEARED_OVERRIDE, overrideFields } from '@/lib/team-profile/override'
import { loadSurveyEvent } from '@/lib/survey/events'
import { refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

// Company management for an event (admins + assigned event managers).
//   GET  — list companies with participant counts
//   PUT  — { count } set number of companies (1-10); trims/creates rows
//   POST — { action: 'auto_assign' }  (lib/team-profile/assign.ts: students
//          with a submitted team profile or an override; hand-placed students
//          stay put)
//          { action: 'rename', companyId, name }
//          { action: 'move', participantId, companyId | null }
//          { action: 'override', participantId, overridden }  (lib/team-profile/
//          override.ts: let Auto-Assign place a student without a team profile)
//          { action: 'override_all' }  every student not yet submitted
//
// The list, the count, a company's name and a student's move are the 'events-config'
// area (lib/events/admin-config.ts): today's queries unless TENANT_DB_AREAS names it.
// Auto-Assign and the overrides are the 'team-profiles' area (lib/team-profile/admin-data.ts,
// S5 A10c): today's queries unless TENANT_DB_AREAS names it. A tenant's staff reach those
// three only when the area is in tenant mode (the tenant database answers), under the tenant row
// policies; on the service and shadow paths they are refused as before. Stellr's staff are
// unaffected either way.

const ROUTE = '/api/admin/events/[slug]/companies'

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response

  try {
    const companies = await loadEventCompanies(supabaseServer(), crew.tenantId, slug)
    return NextResponse.json({ companies })
  } catch (err) {
    // The code only (a SQLSTATE or an error class name, never the message), so a
    // tenantDb that cannot start (TenantContextError: no CA, or a URL that is not
    // verify-full) shows in the logs, as the write paths' failures do.
    console.error('[companies] list failed:', errorCodeOf(err))
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export const PUT = withAudit(
  ({ args: [req] }: { args: [Request, Params] }) => ({ action: 'event_company.count.set', ...auditSubject(req, 'event_companies') }),
  setCount,
)

async function setCount(req: Request, { params }: Params) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })

  const body = await req.json().catch(() => null)
  const count = Number(body?.count)
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return NextResponse.json({ error: 'count must be an integer between 1 and 10' }, { status: 400 })
  }
  noteAuditSubject(req, { detail: { count } })

  // Creates any missing companies up to `count` and removes those above it
  // (participants.company_id nulls via ON DELETE SET NULL).
  if (!(await setEventCompanyCount(supabaseServer(), crew.tenantId, slug, count))) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Params] }) => ({ action: 'event_company.placement.change', ...auditSubject(req, 'event_companies') }),
  changePlacement,
)

const STELLR_ONLY_ACTIONS = new Set(['override', 'override_all', 'auto_assign'])

async function changePlacement(req: Request, { params }: Params) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })

  const body = await req.json().catch(() => null)
  const action = body?.action
  if (typeof action === 'string' && /^[a-z_]{1,20}$/.test(action)) noteAuditSubject(req, { detail: { op: action } })
  if (STELLR_ONLY_ACTIONS.has(action) && !teamProfilesOnTenantPath()) {
    const refused = refuseOutsideStellr(crew.scope)
    if (refused) return refused
  }
  const db = supabaseServer()

  if (action === 'rename') {
    const { companyId, name } = body ?? {}
    if (typeof companyId !== 'string') return NextResponse.json({ error: 'companyId required' }, { status: 400 })
    noteAuditSubject(req, { id: companyId })
    const saved = await renameEventCompany(
      db,
      crew.tenantId,
      slug,
      companyId,
      typeof name === 'string' && name.trim() ? name.trim() : null,
    )
    if (!saved) return NextResponse.json({ error: 'Database error' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'move') {
    const { participantId, companyId } = body ?? {}
    if (typeof participantId !== 'string') {
      return NextResponse.json({ error: 'participantId required' }, { status: 400 })
    }
    // deep review AUTH-3: confine the move to a participant OF THIS EVENT before
    // writing. The route's check only proves the caller may manage `slug`; the
    // update below is keyed on participantId alone, so without this check an
    // event manager assigned to one event could pass any event's participant id
    // and retarget (or unlock) that other event's company placement — and badges,
    // certificates and awards are keyed on company_id. Scope the id to `slug` via
    // its registration, exactly as the sibling participant-keyed routes do
    // (check-in, team-profile store). Fail closed: unknown-for-this-event → 404.
    if (!(await findEventParticipant(db, slug, participantId))) {
      return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
    }
    noteAuditSubject(req, { id: participantId })
    if (companyId !== null && !(await findEventCompany(db, slug, companyId))) {
      return NextResponse.json({ error: 'Unknown company' }, { status: 400 })
    }
    // A hand placement sticks: Auto-Assign leaves it alone. Moving a student
    // back to unassigned releases them.
    // The 'events-config' area (C18 leftover): today's update, or the tenantDb write under
    // the tenant policies when TENANT_DB_AREAS names the area in tenant mode.
    if (!(await moveEventParticipant(db, crew.tenantId, slug, participantId, companyId as string | null))) {
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'override') {
    const { participantId, overridden } = body ?? {}
    if (typeof participantId !== 'string' || typeof overridden !== 'boolean') {
      return NextResponse.json({ error: 'participantId and overridden required' }, { status: 400 })
    }
    // Scoped to this event before writing, as `move` is (AUTH-3).
    if (!(await findEventParticipant(db, slug, participantId))) {
      return NextResponse.json({ error: 'Participant not found for this event' }, { status: 404 })
    }
    noteAuditSubject(req, { id: participantId })
    if (overridden && (await teamProfileSubmittedAt(db, participantId))) {
      return NextResponse.json({ error: 'They’ve already submitted a team profile.' }, { status: 409 })
    }
    const fields = overridden
      ? overrideFields({ userId: crew.userId, name: (await actorFromAuth()).actorLabel ?? null })
      : CLEARED_OVERRIDE
    if (!(await overrideParticipant(db, crew.tenantId, slug, participantId, fields))) {
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'override_all') {
    try {
      const actor = await actorFromAuth()
      const result = await overrideOutstandingEvent(db, crew.tenantId, slug, { userId: crew.userId, name: actor.actorLabel ?? null })
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      console.error('[companies] override all failed:', err)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
  }

  if (action === 'auto_assign') {
    const event = await loadSurveyEvent(slug)
    try {
      const result = await autoAssignEvent(db, crew.tenantId, slug, event?.date ?? null)
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof AssignError) return NextResponse.json({ error: err.message }, { status: 400 })
      console.error('[companies] auto-assign failed:', err)
      return NextResponse.json({ error: 'Database error during assignment' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
