import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { assertPlatformAdmin, writeRefusal } from '@/lib/authz'
import { requireStrictStepUp } from '@/lib/authz/step-up'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation } from '@/lib/audit/route'
import { supabaseServer } from '@/lib/supabase'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { isTenantFlag, TENANT_FLAGS } from '@/lib/tenancy/tenant-flags'

// S6-CON-b: set one per-tenant switch from the super-admin console.
//
// POST { flag, enabled } on the platform host. The flags and their defaults are
// lib/tenancy/tenant-flags.ts; the table's CHECK lists the same names.
//
// Fails closed, as the status route does:
//   - a tenant host: 404 (the console runs on the platform host only, S6-Q7);
//   - a platform admin only (assertPlatformAdmin), refused inside a support session;
//   - the strict step-up: a factor in the last 5 minutes, whatever ADMIN_STEP_UP_ENFORCE says;
//   - never the platform owner (the table's trigger refuses it too);
//   - the change goes on the TENANT's audit chain, or it is undone: with the audit log
//     off the answer is 503 before anything changes.

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/platform/tenants/[id]/flags'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!auditEnabled()) return refuse(503, 'Changing a tenant switch needs the platform audit log (PLATFORM_AUDIT_ENABLED).')

  const { id } = await ctx.params
  if (!UUID.test(id)) return refuse(404, 'Tenant not found')
  const tenantId = id.toLowerCase()
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!isTenantFlag(b.flag)) return refuse(400, `flag must be one of: ${Object.keys(TENANT_FLAGS).join(', ')}`)
  if (typeof b.enabled !== 'boolean') return refuse(400, 'enabled must be true or false')
  const flag = b.flag
  const enabled = b.enabled

  const db = supabaseServer()
  const { data: tenant, error: readError } = await db.from('tenants').select('id, is_platform_owner').eq('id', tenantId).maybeSingle()
  if (readError) return refuse(503, 'Could not load the tenant.')
  if (!tenant) return refuse(404, 'Tenant not found')
  if ((tenant as { is_platform_owner: boolean }).is_platform_owner) return refuse(403, 'The platform owner has no tenant switches.', 'platform_owner')

  const { data: before, error: beforeError } = await db.from('tenant_feature_flags').select('enabled').eq('tenant_id', tenantId).eq('flag', flag).maybeSingle()
  if (beforeError) return refuse(503, 'Could not read the switch.')
  const previous = before ? Boolean((before as { enabled: boolean }).enabled) : null

  const { error: writeError } = await db
    .from('tenant_feature_flags')
    .upsert({ tenant_id: tenantId, flag, enabled, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: 'tenant_id,flag' })
  if (writeError) return refuse(503, 'Could not change the switch.')

  const audited = await auditMutation(
    {
      action: 'platform.tenant_flag.set',
      actor: { userId },
      tenant: { tenantId },
      target: { table: 'tenant_feature_flags', id: tenantId },
      reason: 'platform_console',
      metadata: { flag, enabled, previous: previous ?? TENANT_FLAGS[flag].default },
    },
    { afterResponse: false },
  )
  if (!audited.ok) {
    // A change the tenant cannot see on its audit page must not stand: put back what was there.
    if (previous === null) await db.from('tenant_feature_flags').delete().eq('tenant_id', tenantId).eq('flag', flag)
    else await db.from('tenant_feature_flags').update({ enabled: previous }).eq('tenant_id', tenantId).eq('flag', flag)
    return refuse(503, 'The change could not be recorded, so it was undone. Try again.')
  }
  return NextResponse.json({ tenantId, flag, enabled }, { headers: { 'Cache-Control': 'no-store' } })
}
