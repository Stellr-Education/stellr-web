import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { stellrOnlyDb, type StellrOnlyDb } from '@/lib/events/admin-records'
import { awardAssignments, awardsIssuedAt } from '@/lib/events/admin-awards'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import {
  assignmentConflict,
  isAssignedAwardType,
  isSpecialist,
  type AssignedAwardType,
  type Assignment,
} from '@/lib/event-awards'
import {
  attendees,
  fullName,
  listAssignments,
  listEventCompanies,
  listEventStudents,
  type AssignmentRow,
} from '@/lib/event-certificates'
import { pendingAwardChanges } from '@/lib/event-award-issue'
import { bodyIds, withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

// S5 wave 8, C19b: tenant_crew, and Stellr-only for other tenants. Issued awards become
// credentials Stellr Education issues (decision W7-9), so both handlers ask stellrOnlyEvent
// right after the access check: a tenant's staff get its 503, another tenant's event is a 404
// for everyone, a Stellr admin included, and a failed read of the event's owner is a
// retryable 503. Stellr's own events answer as before.
const ROUTE = '/api/admin/events/[slug]/awards'

// Platform audit (docs/TENANCY-S5.md, C7). The handler notes who passed requireEventRoute and
// the tenant it resolved; the event goes on that tenant's chain.

// Which change (an enum), the award type and the ids it named are the metadata.
const assignAudit = ({ args: [req] }: { args: [Request, { params: Promise<{ slug: string }> }] }) => ({
  action: 'event.awards.assign' as const,
  ...auditSubject(req, 'event_award_assignments'),
})
const AWARD_ACTIONS = ['set_champion', 'add', 'remove', 'set_specialist'] as const

export const PUT = withAudit(assignAudit, changeAssignment)

// Judging results for an event, as a draft. Nothing here reaches a student
// until ./issue turns the assignments into credentials.
// Rules (lib/event-awards.ts): champion = a whole company; each specialist
// award = one student per company; Norm Chaffee Award = any number of the
// champions; one individual award (specialist or finalist) per student.
// Finalists follow the champions: a student who loses Overall Champion loses
// the finalist pick with it.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  return NextResponse.json(await snapshot(stellrOnlyDb(crew.scope, supabaseServer()), slug))
}

// Only students who took part can be judged: a registered no-show (never
// checked in, usually never placed) would otherwise surface as a "No company"
// row and be eligible for awards.
async function eligibleStudents(db: StellrOnlyDb, slug: string) {
  return attendees(await listEventStudents(db, slug))
}

async function snapshot(db: StellrOnlyDb, slug: string) {
  const [students, companies, assignments, pending, issuedAt] = await Promise.all([
    eligibleStudents(db, slug),
    listEventCompanies(db, slug),
    listAssignments(db, slug),
    pendingAwardChanges(db, slug),
    awardsIssuedAt(db, slug),
  ])
  return {
    companies,
    students: students.map((s) => ({ id: s.id, name: fullName(s), companyId: s.company_id })),
    assignments: assignments.map(toAssignment),
    issuedAt,
    pending,
  }
}

function toAssignment(a: AssignmentRow): Assignment {
  return { awardType: a.award_type, participantId: a.participant_id, companyId: a.company_id }
}

type Body =
  | { action: 'set_champion'; companyId: string | null }
  | { action: 'add'; awardType: AssignedAwardType; participantId: string }
  | { action: 'remove'; awardType: AssignedAwardType; participantId: string }
  | { action: 'set_specialist'; awardType: AssignedAwardType; companyId: string | null; participantId: string | null }

// PUT — one change at a time; returns the new snapshot.
async function changeAssignment(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = (await req.json().catch(() => ({}))) as Partial<Body> & Record<string, unknown>
  noteAuditSubject(req, {
    detail: {
      ...((AWARD_ACTIONS as readonly unknown[]).includes(body.action) ? { award_action: body.action } : {}),
      ...(isAssignedAwardType(body.awardType) ? { award_type: body.awardType } : {}),
      ...bodyIds({ participant_id: body.participantId, company_id: body.companyId }, ['participant_id', 'company_id']),
    },
  })
  const db = stellrOnlyDb(crew.scope, supabaseServer())
  const students = await eligibleStudents(db, slug)
  const byId = new Map(students.map((s) => [s.id, s]))
  const assignments = (await listAssignments(db, slug)).map(toAssignment)
  const table = () => awardAssignments(db)
  const row = (awardType: AssignedAwardType, participantId: string) => ({
    event_slug: slug,
    award_type: awardType,
    participant_id: participantId,
    company_id: byId.get(participantId)?.company_id ?? null,
    assigned_by: crew.userId,
  })
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
  const duplicate = (error: { code?: string; message: string }) =>
    error.code === '23505' ? fail('That student already holds an individual award.', 409) : fail(error.message, 500)

  switch (body.action) {
    case 'set_champion': {
      const companyId = typeof body.companyId === 'string' ? body.companyId : null
      const members = companyId ? students.filter((s) => s.company_id === companyId) : []
      if (companyId && members.length === 0) return fail('That company has no students.')
      // Finalists first, so no finalist is ever left without the champion award.
      const keep = new Set(members.map((m) => m.id))
      const stale = assignments.filter((a) => a.awardType === 'norm_chaffee' && !keep.has(a.participantId))
      if (stale.length) {
        const { error } = await table()
          .delete()
          .eq('event_slug', slug)
          .eq('award_type', 'norm_chaffee')
          .in('participant_id', stale.map((a) => a.participantId))
        if (error) return fail(error.message, 500)
      }
      const { error: delError } = await table().delete().eq('event_slug', slug).eq('award_type', 'overall_champion')
      if (delError) return fail(delError.message, 500)
      if (members.length) {
        const { error } = await table().insert(members.map((m) => row('overall_champion', m.id)))
        if (error) return fail(error.message, 500)
      }
      break
    }

    case 'add': {
      if (!isAssignedAwardType(body.awardType) || typeof body.participantId !== 'string') return fail('awardType and participantId are required')
      if (!byId.has(body.participantId)) return fail('Not a student at this event.', 404)
      if (isSpecialist(body.awardType)) return fail('Use set_specialist for specialist awards.')
      const conflict = assignmentConflict(assignments, {
        awardType: body.awardType,
        participantId: body.participantId,
        companyId: byId.get(body.participantId)?.company_id ?? null,
      })
      if (conflict) return fail(conflict, 409)
      const { error } = await table().upsert(row(body.awardType, body.participantId), {
        onConflict: 'event_slug,participant_id,award_type',
        ignoreDuplicates: true,
      })
      if (error) return duplicate(error)
      break
    }

    case 'remove': {
      if (!isAssignedAwardType(body.awardType) || typeof body.participantId !== 'string') return fail('awardType and participantId are required')
      if (body.awardType === 'overall_champion') {
        const { error } = await table()
          .delete()
          .eq('event_slug', slug)
          .eq('award_type', 'norm_chaffee')
          .eq('participant_id', body.participantId)
        if (error) return fail(error.message, 500)
      }
      const { error } = await table()
        .delete()
        .eq('event_slug', slug)
        .eq('award_type', body.awardType)
        .eq('participant_id', body.participantId)
      if (error) return fail(error.message, 500)
      break
    }

    case 'set_specialist': {
      const awardType = body.awardType
      if (!isAssignedAwardType(awardType) || !isSpecialist(awardType)) return fail('A specialist awardType is required')
      const companyId = typeof body.companyId === 'string' ? body.companyId : null
      const participantId = typeof body.participantId === 'string' ? body.participantId : null
      if (participantId) {
        const student = byId.get(participantId)
        if (!student) return fail('Not a student at this event.', 404)
        if (student.company_id !== companyId) return fail('That student is not in this company.')
        const conflict = assignmentConflict(assignments, { awardType, participantId, companyId })
        if (conflict) return fail(conflict, 409)
        if (assignments.some((a) => a.awardType === awardType && a.participantId === participantId)) break
      }
      // One winner per company: clear the current one, then set the new one.
      let clear = table().delete().eq('event_slug', slug).eq('award_type', awardType)
      clear = companyId ? clear.eq('company_id', companyId) : clear.is('company_id', null)
      const { error: delError } = await clear
      if (delError) return fail(delError.message, 500)
      if (participantId) {
        const { error } = await table().insert(row(awardType, participantId))
        if (error) return duplicate(error)
      }
      break
    }

    default:
      return fail('Unknown action')
  }

  return NextResponse.json(await snapshot(db, slug))
}
