import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { requireEventCrew } from '@/lib/authz'
import { stripeClient } from '@/lib/stripe'
import { loadStellrScholarship, requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { issueScholarshipRefund } from '@/lib/scholarship-refund'
import { SCHOLARSHIP_COLUMNS, type ScholarshipApplication } from '@/lib/scholarships'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const ROUTE = '/api/admin/scholarships/[id]/refund'

// POST /api/admin/scholarships/[id]/refund — retry the reimbursement for a
// student who had already paid, after a first attempt needed manual handling
// (e.g. Stripe was unreachable). Safe to repeat: a scholarship reimbursement
// already issued is not issued again, and the Stripe refund carries the same
// idempotency key as the first attempt.
//
// Stellr's applications only (C20b; tenant_crew since C20, lib/scholarship-admin.ts): the refund is on
// Stellr's Stripe account, so another tenant's is refused before Stripe is called.
const schema = z.object({}).passthrough()

type Args = [Request, { params: Promise<{ id: string }> }]

export const POST = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'scholarship.refund.issue', ...auditSubject(req, 'scholarship_applications') }),
  refund,
)

async function refund(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { id } = await params
  const loaded = await loadStellrScholarship<ScholarshipApplication & { tenant_id: string | null }>(crew, supabaseServer(), id, {
    label: ROUTE,
    select: `${SCHOLARSHIP_COLUMNS}, tenant_id`,
    // A missing application has no reimbursement, as before.
    notFound: noReimbursement,
  })
  if (!loaded.ok) return loaded.response
  const { db, row: app } = loaded
  if (app.status !== 'offered' || !app.registration_id || app.percent_off == null || !app.registration_paid_at_offer) {
    return noReimbursement()
  }
  noteAuditSubject(req, {
    userId: reviewer.clerkUserId,
    tenantId: STELLR_TENANT_ID,
    id,
    eventSlug: app.event_slug ?? undefined,
    detail: { registrationId: app.registration_id },
  })
  const result = await issueScholarshipRefund(db, stripeClient(), {
    applicationId: app.id,
    registrationId: app.registration_id,
    percent: app.percent_off,
    actorMemberId: reviewer.memberId,
  })
  noteAuditSubject(req, { detail: { registrationId: app.registration_id, result: result.type } })
  return NextResponse.json({ ok: result.type === 'cash', result })
}

function noReimbursement() {
  return NextResponse.json({ error: 'Only an offer on an already-paid registration has a reimbursement' }, { status: 409 })
}
