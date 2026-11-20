import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { assertNotImpersonating } from '@/lib/impersonation'
import { saveAddonSettings } from '@/lib/addons/catalog'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

const ROUTE = '/api/admin/events/[slug]/addons/settings'

const schema = z.object({
  merchUpsell: z.boolean(),
  inclusions: z.array(z.string().trim().min(1).max(200)).max(20),
})

// An event's add-on settings: the merch upsell (on by default) and what the place
// includes, shown on the event page. Admins and the event's managers, Stellr's events only.
export const PUT = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_addon.settings.update', ...auditSubject(req, 'event_addon_settings') }),
  save,
)

async function save(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'merchUpsell and inclusions are required' }, { status: 400 })
  noteAuditSubject(req, { detail: { merchUpsell: parsed.data.merchUpsell } })
  const res = await saveAddonSettings(stellrOnlyDb(crew.scope, supabaseServer()), slug, parsed.data, crew.userId)
  if (!res.ok) return NextResponse.json({ error: 'Could not save the settings' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
