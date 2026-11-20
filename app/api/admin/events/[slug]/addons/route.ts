import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { assertNotImpersonating } from '@/lib/impersonation'
import { createAddon, loadAddonSettings, loadAdminAddons, loadStoreProductsForAddons } from '@/lib/addons/catalog'
import { addonInputSchema } from '@/lib/addons/rules'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

const ROUTE = '/api/admin/events/[slug]/addons'

// An event's add-ons (docs/PLAN-event-add-ons-2026-11-17.md, Phase 1): accommodation,
// experiences and merch. Admins and the event's managers. Stellr's events only: another
// tenant's event, and a tenant's staff, are refused (plan, "Out of scope").
//   GET  — every add-on (archived included) with live counts, the settings, and the
//          store products for the merch picker
//   POST — create one
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const db = stellrOnlyDb(crew.scope, supabaseServer())
  try {
    const [addons, settings, products] = await Promise.all([loadAdminAddons(db, slug), loadAddonSettings(db, slug), loadStoreProductsForAddons(db)])
    return NextResponse.json({ addons, settings, products })
  } catch (e) {
    console.error('[admin/addons] load:', e)
    return NextResponse.json({ error: 'Could not load add-ons' }, { status: 500 })
  }
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_addon.record.create', ...auditSubject(req, 'event_addons') }),
  create,
)

async function create(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked

  const parsed = addonInputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid add-on', issues: parsed.error.issues }, { status: 400 })
  }
  const res = await createAddon(stellrOnlyDb(crew.scope, supabaseServer()), slug, parsed.data, crew.userId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  noteAuditSubject(req, { id: res.id, detail: { kind: parsed.data.kind } })
  return NextResponse.json({ ok: true, id: res.id })
}
