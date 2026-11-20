import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { loadStellrScholarship, requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const ROUTE = '/api/admin/scholarships/[id]'

// PATCH /api/admin/scholarships/[id] — reviewer notes. (Event, member and
// level are set by the offer itself.) Stellr's applications only (C20b,
// lib/scholarship-admin.ts): another tenant's answers as a missing one.
const schema = z.object({ adminNotes: z.string().max(5000) })

type Args = [Request, { params: Promise<{ id: string }> }]

export const PATCH = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'scholarship.notes.update', ...auditSubject(req, 'scholarship_applications') }),
  saveNotes,
)

async function saveNotes(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const db = supabaseServer()
  const loaded = await loadStellrScholarship(db, id, { label: ROUTE })
  if (!loaded.ok) return loaded.response
  noteAuditSubject(req, { userId: reviewer.clerkUserId, tenantId: STELLR_TENANT_ID, id, eventSlug: loaded.row.event_slug ?? undefined })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { error } = await db
    .from('scholarship_applications')
    .update({ admin_notes: parsed.data.adminNotes.trim() || null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not save notes' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
