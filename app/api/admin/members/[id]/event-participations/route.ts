import { auth } from '@clerk/nextjs/server'
import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { applyGrantTrigger } from '@/lib/membership-grants'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

type Ctx = { params: Promise<{ id: string }> }

/** The member in the URL, /api/admin/members/<id>/…: the event's target. */
function memberIdOf(req: Request): string | null {
  const parts = new URL(req.url).pathname.split('/')
  const at = parts.indexOf('members')
  return at < 0 ? null : (parts[at + 1] ?? null)
}

// Platform audit (docs/TENANCY-S5.md, C7): the new record is the target; the member,
// and how many grant rules fired, go in the metadata. No team name or award text.
const createAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({
  action: 'event_participation.record.create' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: auditSubject(req, 'event_participations').target,
  metadata: { member_id: memberIdOf(req), ...auditSubject(req, 'event_participations').metadata },
})

export const POST = withAudit(createAudit, createParticipation)

// POST /api/admin/members/[id]/event-participations — admin adds event record for a member
async function createParticipation(req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!(await hasCapability('members:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: memberId } = await params
  const body = await req.json()
  const { event_year, event_location, team_name, award } = body

  const db = supabaseServer()

  const { data, error } = await db
    .from('event_participations')
    .insert({
      member_id: memberId,
      event_year: event_year || null,
      event_location: event_location || null,
      team_name: team_name || null,
      award: award || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Admin event participation insert error:', error)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }

  // Fire membership grant rules: attendance always, plus an award upgrade when an
  // award is recorded. Rules decide which tier (if any) applies for the member's
  // role/bracket; an empty rule set is a no-op. Best-effort — never block the save.
  const grants: Array<{ trigger: string; rule: string | null; granted: boolean }> = []
  try {
    const attend = await applyGrantTrigger(memberId, 'event_attendance', { grantKeySeed: data.id }, db)
    grants.push({ trigger: 'event_attendance', rule: attend.rule?.name ?? null, granted: attend.granted })
    if (award) {
      const won = await applyGrantTrigger(memberId, 'event_award', { award, grantKeySeed: data.id }, db)
      grants.push({ trigger: 'event_award', rule: won.rule?.name ?? null, granted: won.granted })
    }
  } catch (e) {
    console.error('Admin event participation grant-trigger error:', e)
  }

  noteAuditSubject(req, { id: data.id, detail: { has_award: !!award, grants: grants.filter((g) => g.granted).length } })
  return NextResponse.json({ participation: data, grants })
}
