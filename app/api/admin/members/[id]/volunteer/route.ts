import { auth } from '@clerk/nextjs/server'
import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { grantVolunteerRole, revokeVolunteerRole } from '@/lib/volunteer'
import { withAudit } from '@/lib/audit/route'

// Admin toggle for the additive volunteer role (PRD §15: "update whether an
// account is a Volunteer or not"). Granting also puts the member on the
// Volunteer Space roster; revoking removes them.

type Ctx = { params: Promise<{ id: string }> }

/** The member in the URL, /api/admin/members/<id>/…: the event's target. */
function memberIdOf(req: Request): string | null {
  const parts = new URL(req.url).pathname.split('/')
  const at = parts.indexOf('members')
  return at < 0 ? null : (parts[at + 1] ?? null)
}

// Platform audit (docs/TENANCY-S5.md, C7): the member is the target.
const grantAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({
  action: 'role.volunteer.grant' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdOf(req) },
})
const revokeAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({
  action: 'role.volunteer.revoke' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdOf(req) },
})

export const POST = withAudit(grantAudit, grantVolunteer)
export const DELETE = withAudit(revokeAudit, revokeVolunteer)

async function grantVolunteer(_req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!(await hasCapability('volunteers:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const actor = await actorFromAuth()
  await grantVolunteerRole(db, id, actor, 'admin')
  return NextResponse.json({ ok: true })
}

async function revokeVolunteer(_req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!(await hasCapability('volunteers:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const actor = await actorFromAuth()
  await revokeVolunteerRole(db, id, actor)
  return NextResponse.json({ ok: true })
}
