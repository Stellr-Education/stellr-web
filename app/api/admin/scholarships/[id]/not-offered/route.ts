import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { loadStellrScholarship, requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { markNotOffered } from '@/lib/scholarship-offer'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const ROUTE = '/api/admin/scholarships/[id]/not-offered'

type Args = [Request, { params: Promise<{ id: string }> }]

export const POST = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'scholarship.offer.decline', ...auditSubject(req, 'scholarship_applications') }),
  notOffered,
)

// POST /api/admin/scholarships/[id]/not-offered — closes an application
// without an offer. No email goes to the applicant (owner, 2 Oct 2026).
// Stellr's applications only (C20b, lib/scholarship-admin.ts).
async function notOffered(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const db = supabaseServer()
  const loaded = await loadStellrScholarship(db, id, { label: ROUTE })
  if (!loaded.ok) return loaded.response
  noteAuditSubject(req, { userId: reviewer.clerkUserId, tenantId: STELLR_TENANT_ID, id, eventSlug: loaded.row.event_slug ?? undefined })

  const result = await markNotOffered(db, id, reviewer)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
  return NextResponse.json({ ok: true })
}
