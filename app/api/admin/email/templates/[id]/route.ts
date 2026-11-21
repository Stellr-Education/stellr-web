import { isStellrAdmin } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { storableId, withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { unknownTokens } from '@/lib/email-tokens'
import { tiptapToPlainText } from '@/lib/community'

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  bodyJson: z.unknown().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

// Platform audit (docs/TENANCY-S5.md, C7): the template is the target; which fields were
// edited (names, never values) the metadata.
export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'email.template.update', ...adminAuditSubject(req, 'email_templates') }),
  updateTemplate,
)
export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'email.template.archive', ...adminAuditSubject(req, 'email_templates') }),
  archiveTemplate,
)

// PATCH /api/admin/email/templates/[id] — edit a template.
async function updateTemplate(req: Request, { params }: Ctx) {
  if (!(await isStellrAdmin({ route: '/api/admin/email/templates/[id]' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { name, subject, bodyJson } = parsed.data

  if (subject !== undefined || bodyJson !== undefined) {
    const bad = unknownTokens(subject ?? '', bodyJson !== undefined ? tiptapToPlainText(bodyJson) : '')
    if (bad.length) return NextResponse.json({ error: `Unknown merge fields: ${bad.map((t) => `{{${t}}}`).join(', ')}` }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) update.name = name
  if (subject !== undefined) update.subject = subject
  if (bodyJson !== undefined) update.body_json = bodyJson

  noteAuditSubject(req, { id: storableId(id), detail: { fields: Object.keys(update).filter((k) => k !== 'updated_at') } })
  const db = supabaseServer()
  const { error } = await db.from('email_templates').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/email/templates/[id] — soft-delete (archive). Blocked if a
// non-archived campaign still references it (FK is RESTRICT anyway).
async function archiveTemplate(req: Request, { params }: Ctx) {
  if (!(await isStellrAdmin({ route: '/api/admin/email/templates/[id]' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  noteAuditSubject(req, { id: storableId(id) })

  const db = supabaseServer()
  const { count } = await db
    .from('email_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id)
    .neq('status', 'archived')
  if (count && count > 0) {
    return NextResponse.json({ error: 'Template is used by an active campaign. Archive the campaign first.' }, { status: 409 })
  }

  const { error } = await db.from('email_templates').update({ is_archived: true }).eq('id', id)
  if (error) return NextResponse.json({ error: 'Failed to archive' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
