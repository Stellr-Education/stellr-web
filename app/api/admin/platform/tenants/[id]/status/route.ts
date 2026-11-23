import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { assertPlatformAdmin, writeRefusal } from '@/lib/authz'
import { requireStrictStepUp } from '@/lib/authz/step-up'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation } from '@/lib/audit/route'
import { supabaseServer } from '@/lib/supabase'
import { requestTenant } from '@/lib/tenancy/request-tenant'

// S6-CON: suspend or resume a tenant from the super-admin console.
//
// POST { status: 'suspended' | 'active', reason } on the platform host. A suspended
// tenant's hosts drop out of the proxy's host map (tenant_host_map lists active tenants
// only) within its TTL plus max-stale, 2 minutes per instance (lib/tenancy/host.ts), and
// answer as unknown hosts. Its data is untouched; resuming brings the hosts back.
//
// Fails closed:
//   - a tenant host: 404 (the console runs on the platform host only, S6-Q7);
//   - a platform admin only (assertPlatformAdmin), refused inside a support session;
//   - the strict step-up: a factor in the last 5 minutes, whatever ADMIN_STEP_UP_ENFORCE says;
//   - never the platform owner, and only active <-> suspended (provisioning and archived
//     are not the console's to change). Resuming is refused by the database's readiness
//     lock until the platform is attested ready for tenants (409);
//   - the change goes on the TENANT's audit chain, or it is undone: with the audit log
//     off the answer is 503 before anything changes.
//
// The reason (20 to 500 characters) is required so the admin states one, but it is not
// stored: the chain can never be erased, so it carries a fixed code instead.

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/platform/tenants/[id]/status'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REASON_MIN = 20
const REASON_MAX = 500

function refuse(status: number, error: string, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function onTenantHost(): Promise<boolean> {
  try {
    return (await requestTenant()).kind !== 'stellr'
  } catch {
    return true
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (await onTenantHost()) return refuse(404, 'Not found')
  const { userId } = await auth()
  if (!userId || !(await assertPlatformAdmin({ route: ROUTE })).ok) return refuse(403, 'Forbidden')
  // Not withAudit: the change is audited inline, on the tenant's chain, so the refusal is here.
  const refused = writeRefusal(req)
  if (refused) return refused
  const stepUp = await requireStrictStepUp()
  if (stepUp) return stepUp
  if (!auditEnabled()) return refuse(503, 'Suspending a tenant needs the platform audit log (PLATFORM_AUDIT_ENABLED).')

  const { id } = await ctx.params
  if (!UUID.test(id)) return refuse(404, 'Tenant not found')
  const tenantId = id.toLowerCase()
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (b.status !== 'suspended' && b.status !== 'active') return refuse(400, "status must be 'suspended' or 'active'")
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return refuse(400, `reason must be ${REASON_MIN} to ${REASON_MAX} characters`)
  const to = b.status
  const from = to === 'suspended' ? 'active' : 'suspended'

  const db = supabaseServer()
  const { data: tenant, error: readError } = await db.from('tenants').select('id, status, is_platform_owner').eq('id', tenantId).maybeSingle()
  if (readError) return refuse(503, 'Could not load the tenant.')
  if (!tenant) return refuse(404, 'Tenant not found')
  const t = tenant as { id: string; status: string; is_platform_owner: boolean }
  if (t.is_platform_owner) return refuse(403, 'The platform owner cannot be suspended.', 'platform_owner')
  if (t.status !== from) return refuse(409, `The tenant is ${t.status}, so it cannot be set to ${to} here.`, 'tenant_status')

  // Only from the status just read, so two admins cannot race each other.
  const { data: changed, error: updateError } = await db.from('tenants').update({ status: to }).eq('id', tenantId).eq('status', from).select('id')
  if (updateError) {
    const lock = (updateError as { code?: string }).code === '55000'
    return lock
      ? refuse(409, 'Tenants cannot be active until the platform is attested ready for tenants.', 'tenancy_not_ready')
      : refuse(503, 'Could not change the tenant.')
  }
  if (!(changed ?? []).length) return refuse(409, 'The tenant changed while you were looking. Reload and try again.', 'tenant_status')

  const audited = await auditMutation(
    {
      action: to === 'suspended' ? 'platform.tenant.suspend' : 'platform.tenant.resume',
      actor: { userId },
      tenant: { tenantId },
      target: { table: 'tenants', id: tenantId },
      reason: 'platform_console',
      metadata: { from, to },
    },
    { afterResponse: false },
  )
  if (!audited.ok) {
    // A change the tenant cannot see on its audit page must not stand.
    await db.from('tenants').update({ status: from }).eq('id', tenantId).eq('status', to)
    return refuse(503, 'The change could not be recorded, so it was undone. Try again.')
  }
  return NextResponse.json({ tenantId, status: to }, { headers: { 'Cache-Control': 'no-store' } })
}
