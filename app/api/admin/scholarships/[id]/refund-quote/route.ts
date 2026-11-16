import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import {
  loadStellrScholarship,
  refuseUnlessStellrScholarshipEvent,
  requireScholarshipAdmin,
  scholarshipScope,
} from '@/lib/scholarship-admin'
import { quoteScholarshipRefund, registrationNotFoundQuote } from '@/lib/scholarship-refund'
import { isScholarshipPercent } from '@/lib/scholarship-levels'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { loadRecord } from '@/lib/tenancy/load-scoped'

const ROUTE = '/api/admin/scholarships/[id]/refund-quote'

type Args = [Request, { params: Promise<{ id: string }> }]

export const GET = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'scholarship.refund_quote.read', ...auditSubject(req, 'scholarship_applications') }),
  refundQuote,
)

// GET /api/admin/scholarships/[id]/refund-quote?registrationId=…&percent=50
// What offering this level would reimburse a student who has already paid —
// shown in the review panel before the reviewer confirms. A read; nothing moves.
//
// Stellr's only (C20b, lib/scholarship-admin.ts): the quote reads Stellr's Stripe
// account, so the application and the registration must both be on Stellr's events.
// A registration that is not one of Stellr's answers as one that cannot be found.
async function refundQuote(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin('portal:read')
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(req.url)
  const registrationId = url.searchParams.get('registrationId')
  const percent = Number(url.searchParams.get('percent'))
  if (!registrationId || !isScholarshipPercent(percent)) {
    return NextResponse.json({ error: 'registrationId and a scholarship level are required' }, { status: 400 })
  }

  const { id } = await params
  const db = supabaseServer()
  const loaded = await loadStellrScholarship(db, id, { label: ROUTE })
  if (!loaded.ok) return loaded.response

  const missing = () => NextResponse.json(registrationNotFoundQuote())
  const reg = await loadRecord<{ id: string; event_slug: string; tenant_id: string | null }>(scholarshipScope(), 'registrations', registrationId, {
    db,
    select: 'id, event_slug, tenant_id',
    notFound: missing,
    label: ROUTE,
  })
  if (!reg.ok) return reg.response
  if ((reg.row.tenant_id ?? STELLR_TENANT_ID) !== STELLR_TENANT_ID) return missing()
  const foreign = await refuseUnlessStellrScholarshipEvent(db, reg.row.event_slug, ROUTE, missing)
  if (foreign) return foreign
  noteAuditSubject(req, { userId: reviewer.clerkUserId, tenantId: STELLR_TENANT_ID, id, eventSlug: reg.row.event_slug, detail: { registrationId, percent } })

  const quote = await quoteScholarshipRefund(db, stripeClient(), registrationId, percent)
  return NextResponse.json(quote)
}
