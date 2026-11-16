import { auth } from '@clerk/nextjs/server'
import { crewActorType } from '@/lib/activity-log'
import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getSignedInMember } from '@/lib/community'
import { sendAccountInvite } from '@/lib/member-invite'
import { withAudit } from '@/lib/audit/route'
import { memberIdOf } from '@/lib/audit-route-helpers'

type Ctx = { params: Promise<{ id: string }> }

// Platform audit (docs/TENANCY-S5.md, C7). A refusal (not found, complete, cooldown) is
// a 4xx and records nothing; a send that failed is a 502 and is recorded.
const inviteAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({
  action: 'member.invite.send' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdOf(req) },
})

export const POST = withAudit(inviteAudit, sendInvite)

// POST /api/admin/members/[id]/invite — (re)send the "complete your account"
// email to a member whose profile is still missing DOB or gender.
async function sendInvite(_req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!(await hasCapability('members:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const actor = await getSignedInMember()
  const result = await sendAccountInvite(supabaseServer(), id, { actorMemberId: actor?.id ?? null, actorType: await crewActorType() })

  if (result.sent) return NextResponse.json({ ok: true })
  switch (result.reason) {
    case 'not_found':
      return NextResponse.json({ error: 'Member not found, or has no email' }, { status: 404 })
    case 'complete':
      return NextResponse.json({ error: 'This member has already completed their profile' }, { status: 409 })
    case 'cooldown':
      return NextResponse.json({ error: 'An invite went out in the last 10 minutes — give it a moment' }, { status: 429 })
    case 'awaiting_consent':
      return NextResponse.json({ error: 'This member is under 13. They get a login once a parent or guardian has signed their agreement.' }, { status: 409 })
    case 'age_unknown':
      return NextResponse.json({ error: 'Add their date of birth, or set an adult age bracket and role, before sending an invite.' }, { status: 409 })
    default:
      return NextResponse.json({ error: 'The email could not be sent' }, { status: 502 })
  }
}
