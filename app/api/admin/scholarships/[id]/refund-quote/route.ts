import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventCrew } from '@/lib/authz'
import { stripeClient } from '@/lib/stripe'
import {
  loadStellrScholarship,
  refuseUnlessStellrScholarshipEvent,
  requireScholarshipAdmin,
} from '@/lib/scholarship-admin'
import { quoteScholarshipRefund, registrationNotFoundQuote } from '@/lib/scholarship-refund'
import { isScholarshipPercent } from '@/lib/scholarship-levels'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { loadEventRecord } from '@/lib/tenancy/load-scoped'

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
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })
  // The application first (C20): one that is not Stellr's answers as missing whatever was asked.
  const { id } = await params
  const loaded = await loadStellrScholarship(crew, supabaseServer(), id, { label: ROUTE })
  if (!loaded.ok) return loaded.response
  const { db } = loaded

  const url = new URL(req.url)
  const registrationId = url.searchParams.get('registrationId')
  const percent = Number(url.searchParams.get('percent'))
  if (!registrationId || !isScholarshipPercent(percent)) {
    return NextResponse.json({ error: 'registrationId and a scholarship level are required' }, { status: 400 })
  }

  const missing = () => NextResponse.json(registrationNotFoundQuote())
  const reg = await loadEventRecord<{ id: string; event_slug: string; tenant_id: string | null }>(crew, 'registrations', registrationId, {
    db,
    select: 'id, event_slug, tenant_id',
    notFound: missing,
    label: ROUTE,
  })
  if (!reg.ok) return reg.response
  if ((reg.row.tenant_id ?? STELLR_TENANT_ID) !== STELLR_TENANT_ID) return missing()
  const foreign = await refuseUnlessStellrScholarshipEvent(crew, db, reg.row.event_slug, ROUTE, missing)
  if (foreign) return foreign
  noteAuditSubject(req, { userId: reviewer.clerkUserId, tenantId: STELLR_TENANT_ID, id, eventSlug: reg.row.event_slug, detail: { registrationId, percent } })

  const quote = await quoteScholarshipRefund(db, stripeClient(), registrationId, percent)
  return NextResponse.json(quote)
}
