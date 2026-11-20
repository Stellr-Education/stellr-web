import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { loadStellrScholarship, refuseUnlessStellrScholarshipEvent, requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { offerScholarship } from '@/lib/scholarship-offer'
import { isScholarshipPercent } from '@/lib/scholarships'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const ROUTE = '/api/admin/scholarships/[id]/offer'

// POST /api/admin/scholarships/[id]/offer — "Offer & register": records the
// level, links the student, attaches any registration they already have, and
// (by default) sends the three offer emails. A student who had already paid is
// reimbursed the difference (lib/scholarship-refund.ts).
//
// Stellr's applications only, and only onto one of Stellr's events (C20b,
// lib/scholarship-admin.ts): the offer draws on Stellr's coupons and Stripe account,
// so another tenant's event is refused before any registration is read, anyone is
// emailed or anything is written.
const schema = z.object({
  percent: z.number().refine(isScholarshipPercent, 'Choose a scholarship level'),
  eventSlug: z.string().min(1, 'Choose an event'),
  memberId: z.guid().nullable().optional(),
  sendEmails: z.boolean().default(true),
})

type Args = [Request, { params: Promise<{ id: string }> }]

export const POST = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'scholarship.offer.create', ...auditSubject(req, 'scholarship_applications') }),
  offer,
)

async function offer(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const { id } = await params
  const { percent, eventSlug, memberId, sendEmails } = parsed.data
  if (!isScholarshipPercent(percent)) return NextResponse.json({ error: 'Choose a scholarship level' }, { status: 400 })

  const db = supabaseServer()
  const loaded = await loadStellrScholarship(db, id, { label: ROUTE })
  if (!loaded.ok) return loaded.response
  // The event the offer registers the student for, which the reviewer chose.
  const foreign = await refuseUnlessStellrScholarshipEvent(db, eventSlug, ROUTE)
  if (foreign) return foreign
  noteAuditSubject(req, { userId: reviewer.clerkUserId, tenantId: STELLR_TENANT_ID, id, eventSlug, detail: { percent, sendEmails } })

  const result = await offerScholarship(db, {
    applicationId: id,
    percent,
    eventSlug,
    memberId: memberId ?? null,
    reviewer,
    sendEmails,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  noteAuditSubject(req, { detail: { percent, sendEmails, registrationId: result.registrationId ?? null } })
  return NextResponse.json({
    ok: true,
    registrationId: result.registrationId,
    emailedTo: result.emailedTo,
    refund: result.refund,
  })
}
