import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/lib/authz'
import { loadSupportSession } from '@/lib/authz/support-session-server'
import { supportModeEnabled } from '@/lib/authz/support-session'
import { withAudit } from '@/lib/audit/route'
import { COMPANY_NAME_MAX, renameCompanyUnderBreakGlass } from '@/lib/support/break-glass-actions'
import { tenantBreakGlassDb } from '@/lib/tenancy/support-db'
import { requestTenant } from '@/lib/tenancy/request-tenant'

// S6-BG's first real change: rename one of an event's companies (team names) in the
// tenant a break-glass session is open on (docs/S6-DESIGN.md section 3).
//
// POST { eventSlug, companyId, name } (name null or '' clears it). Only inside a verified
// break-glass session (loadSupportSession: the cookie, its Clerk binding and the open
// support_sessions row), and the write runs only through tenantBreakGlassDb: tenant_app
// pinned to the SESSION's tenant, never the service role and never a tenant from the
// request. withAudit's breakGlass option lets the session through assertWritable and puts
// the event on that tenant's chain with support_session in its metadata.
//
// 404 when SUPPORT_MODE_ENABLED is off or on a tenant host (S6-Q7); 403 for anyone who is
// not a platform admin; 403 break_glass_required outside a break-glass session (a read
// session is refused earlier by withAudit, support_read_only, and an ended one with
// support_session_ended); 404 when the session's tenant has no such company.

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/platform/support/company-name'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/

function refuse(status: number, error: string, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function unavailable(): Promise<boolean> {
  if (!supportModeEnabled()) return true
  try {
    return (await requestTenant()).kind !== 'stellr'
  } catch {
    return true
  }
}

export const POST = withAudit(
  { action: 'support.company.rename', actor: { session: true }, tenant: { stellr: true }, target: { table: 'event_companies' } },
  async (req: Request) => {
    if (await unavailable()) return refuse(404, 'Not found')
    const { userId } = await auth()
    if (!userId || !(await assertPlatformAdmin({ route: ROUTE })).ok) return refuse(403, 'Forbidden')
    const session = await loadSupportSession()
    if (!session || session.mode !== 'break_glass') {
      return refuse(403, 'Open break-glass on this organization first.', 'break_glass_required')
    }

    const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
    if (typeof b.eventSlug !== 'string' || !SLUG.test(b.eventSlug)) return refuse(400, 'eventSlug must be an event slug')
    if (typeof b.companyId !== 'string' || !UUID.test(b.companyId)) return refuse(400, 'companyId must be a company id')
    if (b.name !== null && b.name !== undefined && typeof b.name !== 'string') return refuse(400, 'name must be text')
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : null
    if (name && name.length > COMPANY_NAME_MAX) return refuse(400, `name must be ${COMPANY_NAME_MAX} characters or fewer`)

    let changed: number
    try {
      changed = await renameCompanyUnderBreakGlass(tenantBreakGlassDb(session), b.eventSlug, b.companyId.toLowerCase(), name)
    } catch {
      return refuse(503, 'The change could not be made. Nothing was saved.')
    }
    if (changed === 0) return refuse(404, 'No such company in this organization.')
    return NextResponse.json({ companyId: b.companyId.toLowerCase(), name }, { headers: { 'Cache-Control': 'no-store' } })
  },
  { breakGlass: true },
)
