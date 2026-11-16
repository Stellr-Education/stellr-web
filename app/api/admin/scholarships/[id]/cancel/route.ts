import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { loadStellrScholarship, requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { cancelScholarship } from '@/lib/scholarship-cancel'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const ROUTE = '/api/admin/scholarships/[id]/cancel'

// POST /api/admin/scholarships/[id]/cancel { reason? } — cancels an offered
// scholarship at any stage. No email goes to the student (owner, 30 Oct 2026).
// Stellr's applications only (C20b, lib/scholarship-admin.ts).
const schema = z.object({ reason: z.string().max(1000).optional() })

type Args = [Request, { params: Promise<{ id: string }> }]

export const POST = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'scholarship.offer.cancel', ...auditSubject(req, 'scholarship_applications') }),
  cancel,
)

async function cancel(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const db = supabaseServer()
  const loaded = await loadStellrScholarship(db, id, { label: ROUTE })
  if (!loaded.ok) return loaded.response
  noteAuditSubject(req, { userId: reviewer.clerkUserId, tenantId: STELLR_TENANT_ID, id, eventSlug: loaded.row.event_slug ?? undefined })

  const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {})
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const result = await cancelScholarship(db, id, { source: 'admin', reason: parsed.data.reason, reviewer })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, message: result.message, amountDueRestoredCents: result.amountDueRestoredCents })
}
