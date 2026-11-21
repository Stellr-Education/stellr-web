import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventCrew } from '@/lib/authz'
import { loadStellrScholarship, requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { sendScholarshipOfferEmails } from '@/lib/scholarship-offer'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const ROUTE = '/api/admin/scholarships/[id]/resend'

type Args = [Request, { params: Promise<{ id: string }> }]

export const POST = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'scholarship.offer_email.resend', ...auditSubject(req, 'scholarship_applications') }),
  resend,
)

// POST /api/admin/scholarships/[id]/resend — sends the offer emails again,
// worded for where the student has got to (e.g. no "complete your details"
// once their details are in, and nothing at all to pay once paid).
// Stellr's applications only (C20b; tenant_crew since C20, lib/scholarship-admin.ts): nobody is emailed
// about another tenant's.
async function resend(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })
  const { id } = await params
  const loaded = await loadStellrScholarship(crew, supabaseServer(), id, { label: ROUTE })
  if (!loaded.ok) return loaded.response
  const { db } = loaded
  noteAuditSubject(req, { userId: reviewer.clerkUserId, tenantId: STELLR_TENANT_ID, id, eventSlug: loaded.row.event_slug ?? undefined })

  const to = await sendScholarshipOfferEmails(db, id)
  if (to.length === 0) return NextResponse.json({ error: 'Only an offered scholarship has emails to send' }, { status: 409 })
  noteAuditSubject(req, { detail: { recipients: to.length } })
  return NextResponse.json({ ok: true, emailedTo: to })
}
