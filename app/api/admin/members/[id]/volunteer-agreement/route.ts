import { auth } from '@clerk/nextjs/server'
import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { dispatchVolunteerAgreement, VOLUNTEER_PROGRAM_TITLE, VOLUNTEER_MEMBER_COLUMNS } from '@/lib/volunteer'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// Admin (re-)issue of the Volunteer Agreement (PRD §15: "issue the Volunteer
// DocuSign to new Volunteers"). Signup normally dispatches it automatically;
// this covers members made volunteers by admin toggle and re-issues after a
// decline/void. force=true bypasses the in-flight guard but NOT the 3-year
// on-file reuse — a member with a valid signed agreement gets coverage, not a
// duplicate envelope.

type Ctx = { params: Promise<{ id: string }> }

/** The member in the URL, /api/admin/members/<id>/…: the event's target. */
function memberIdOf(req: Request): string | null {
  const parts = new URL(req.url).pathname.split('/')
  const at = parts.indexOf('members')
  return at < 0 ? null : (parts[at + 1] ?? null)
}

// Platform audit (docs/TENANCY-S5.md, C7): the member is the target, and the outcome
// (issued, on_file, failed) goes in the metadata. A failed send is a 502, so it is recorded.
const issueAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({
  action: 'agreement.volunteer.issue' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdOf(req) },
  metadata: auditSubject(req, 'members').metadata,
})

export const POST = withAudit(issueAudit, issueVolunteerAgreement)

async function issueVolunteerAgreement(req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!(await hasCapability('members:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select(VOLUNTEER_MEMBER_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!member.email) return NextResponse.json({ error: 'Member has no email on file' }, { status: 400 })

  const agreement = await dispatchVolunteerAgreement(db, member, { force: true })
  noteAuditSubject(req, { detail: { agreement } })

  // Report what actually happened. This route used to answer 200 and log
  // "issued" unconditionally — on 28 Sept 2026 two production issues were
  // rejected by DocuSign (ACCOUNT_LACKS_EXTENSIONS_PERMISSIONS), the admin saw
  // no error, and the activity log recorded agreements that were never sent.
  if (agreement === 'failed') {
    return NextResponse.json(
      { error: 'DocuSign rejected the request, so nothing was sent. The reason is in the server log.', agreement },
      { status: 502 },
    )
  }
  if (agreement === 'not_required') {
    return NextResponse.json({ error: 'No agreement applies to this member.', agreement }, { status: 422 })
  }

  if (agreement === 'issued' || agreement === 'on_file') {
    const actor = await actorFromAuth()
    await logActivity({
      memberId: id,
      category: 'docusign',
      action: agreement === 'issued' ? 'volunteer_agreement_issued' : 'volunteer_agreement_on_file',
      summary: agreement === 'issued'
        ? `Volunteer Agreement issued for ${VOLUNTEER_PROGRAM_TITLE}`
        : `Volunteer Agreement already on file for ${VOLUNTEER_PROGRAM_TITLE}; nothing new sent`,
      ...actor,
    }, db)
  }

  return NextResponse.json({ ok: true, agreement })
}
