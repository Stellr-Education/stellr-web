import { isStellrAdmin } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// The object→object relationship matrix (object_type_relations, migration 125).
// GET returns all 49 cells; PATCH flips one. Read by the Rules-tab matrix editor
// and by every attach endpoint (via lib/access-objects attachAllowed).

export async function GET() {
  if (!(await isStellrAdmin({ route: '/api/admin/access/relations' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data, error } = await db
    .from('object_type_relations')
    .select('from_type, to_type, allowed')
    .order('from_type')
    .order('to_type')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ relations: data ?? [] })
}

const OBJECT_TYPES = ['space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource'] as const

const patchSchema = z.object({
  fromType: z.enum(OBJECT_TYPES),
  toType: z.enum(OBJECT_TYPES),
  allowed: z.boolean(),
})

// Platform audit (docs/TENANCY-S5.md, C7): which cell, and what it now says. The matrix has
// no row id, so there is no target id.
export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'access.relation.set', ...adminAuditSubject(req, 'object_type_relations') }),
  setRelation,
)

async function setRelation(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/access/relations' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { fromType, toType, allowed } = parsed.data
  noteAuditSubject(req, { detail: { from_type: fromType, to_type: toType, allowed } })
  const db = supabaseServer()
  const { error } = await db
    .from('object_type_relations')
    .upsert(
      { from_type: fromType, to_type: toType, allowed, updated_at: new Date().toISOString() },
      { onConflict: 'from_type,to_type' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
