import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { assertNotImpersonating } from '@/lib/impersonation'
import { removeAddon, updateAddon } from '@/lib/addons/catalog'
import { addonInputSchema } from '@/lib/addons/rules'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string; id: string }> }

const ROUTE = '/api/admin/events/[slug]/addons/[id]'

// One add-on of an event. Admins and the event's managers, Stellr's events only.
//   PUT    — replace its settings (a price change affects later sales only)
//   DELETE — delete it if it was never booked, otherwise archive it
export const PUT = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_addon.record.update', ...auditSubject(req, 'event_addons') }),
  update,
)

async function update(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked

  const parsed = addonInputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid add-on', issues: parsed.error.issues }, { status: 400 })
  }
  const res = await updateAddon(stellrOnlyDb(crew.scope, supabaseServer()), slug, id, parsed.data, crew.userId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}

export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_addon.record.delete', ...auditSubject(req, 'event_addons') }),
  remove,
)

async function remove(req: Request, { params }: Ctx) {
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked

  const res = await removeAddon(stellrOnlyDb(crew.scope, supabaseServer()), slug, id, crew.userId)
  if (!res.ok) return NextResponse.json({ error: res.status === 404 ? 'Add-on not found' : 'Could not remove the add-on' }, { status: res.status ?? 500 })
  noteAuditSubject(req, { detail: { archived: res.archived } })
  return NextResponse.json({ ok: true, archived: res.archived })
}
