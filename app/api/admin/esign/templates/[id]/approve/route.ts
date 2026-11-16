import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { approveVersion } from '@/lib/esign/native/template-admin'
import { adminName, failure, forbidden, noStore } from '../../guard'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// POST /api/admin/esign/templates/:id/approve — { confirm: "<key> v<n>" }.
// Re-runs the checks, records who approved it, and puts it in use.

export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type Ctx = { params: Promise<{ id: string }> }

// Platform audit (docs/TENANCY-S5.md, C7): the version approved is the target; its key and
// number the metadata. A failed check is a 422 and records nothing.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'esign.template.approve', ...adminAuditSubject(req, 'esign_templates') }),
  approve,
)

async function approve(req: Request, { params }: Ctx) {
  const by = await adminName()
  if (!by) return forbidden()
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })
  noteAuditSubject(req, { id })
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null
  try {
    const out = await approveVersion(supabaseServer(), id, { by, confirm: typeof body?.confirm === 'string' ? body.confirm : '' })
    console.info(`[esign-templates] ${out.key} v${out.version} approved by ${by}`)
    noteAuditSubject(req, { detail: { template_key: out.key, version: out.version } })
    return NextResponse.json(out, { headers: noStore })
  } catch (err) {
    return failure(err)
  }
}
