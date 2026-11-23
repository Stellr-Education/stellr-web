import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/lib/authz'
import { supportModeEnabled } from '@/lib/authz/support-session'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation } from '@/lib/audit/route'
import { cleanBreakGlassReason, CONSENT_LAPSE_HOURS, REASON_MAX, REASON_MIN } from '@/lib/support/break-glass'
import { supabaseServer } from '@/lib/supabase'
import { requestTenant } from '@/lib/tenancy/request-tenant'

// S6-BG: a platform admin asks a tenant for break-glass access (docs/S6-DESIGN.md
// section 3, S6-Q4).
//
// POST { tenantId, reason } records a pending request in support_consents, which one of
// the tenant's own admins answers (app/api/support-consents/[id]). It lapses after
// CONSENT_LAPSE_HOURS and is spent by opening break-glass (../break-glass).
//
// Every check fails closed, as for support sessions:
//   - SUPPORT_MODE_ENABLED off, or a tenant host: 404 (S6-Q7);
//   - only a platform admin who is a platform_admins row;
//   - never the platform owner (the table's trigger refuses it too);
//   - the request goes on the TENANT's audit chain, so the tenant can see it; with the
//     audit log off, or a failed write, it is withdrawn and the answer is 503.
//
// Asking is not a change to the tenant's data, so a read support session may ask (the
// usual next step after finding a problem while reading): test/assert-writable-guard.test.ts
// WRITABLE_EXEMPTIONS.

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/support/consent'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export async function POST(req: Request) {
  if (await unavailable()) return refuse(404, 'Not found')
  const { userId } = await auth()
  if (!userId || !(await assertPlatformAdmin({ route: ROUTE })).ok) return refuse(403, 'Forbidden')
  if (!auditEnabled()) return refuse(503, 'Support mode needs the platform audit log (PLATFORM_AUDIT_ENABLED).')

  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (typeof body.tenantId !== 'string' || !UUID.test(body.tenantId)) return refuse(400, 'tenantId must be a tenant id')
  const reason = cleanBreakGlassReason(body.reason)
  if (!reason) return refuse(400, `reason must be ${REASON_MIN} to ${REASON_MAX} characters`, 'break_glass_reason')
  const tenantId = body.tenantId.toLowerCase()

  const db = supabaseServer()
  const { data: admin, error: adminError } = await db.from('platform_admins').select('clerk_user_id').eq('clerk_user_id', userId).maybeSingle()
  if (adminError) return refuse(503, 'Could not confirm your platform admin record.')
  if (!admin) return refuse(403, 'Break-glass is for platform admins only.')

  const { data: tenant, error: tenantError } = await db.from('tenants').select('id, is_platform_owner').eq('id', tenantId).maybeSingle()
  if (tenantError) return refuse(503, 'Could not load the tenant.')
  if (!tenant) return refuse(404, 'Tenant not found')
  if ((tenant as { is_platform_owner: boolean }).is_platform_owner) {
    return refuse(403, 'Support mode is for other tenants. Use the ordinary admin screens for this one.', 'support_owner_tenant')
  }

  const now = Date.now()
  const expiresAt = new Date(now + CONSENT_LAPSE_HOURS * 3_600_000).toISOString()
  const { data: created, error: createError } = await db
    .from('support_consents')
    .insert({ tenant_id: tenantId, platform_admin_user_id: userId, reason, requested_at: new Date(now).toISOString(), expires_at: expiresAt })
    .select('id')
    .single()
  if (createError || !created) return refuse(503, 'Could not record the request.')
  const consentId = (created as { id: string }).id

  const audited = await auditMutation(
    {
      action: 'support.consent.request',
      actor: { userId },
      tenant: { tenantId },
      target: { table: 'support_consents', id: consentId },
      reason: 'break_glass',
      metadata: { lapse_hours: CONSENT_LAPSE_HOURS },
    },
    { afterResponse: false },
  )
  if (!audited.ok) {
    // A request the tenant cannot see on its audit page must not be approvable.
    await db.from('support_consents').update({ withdrawn_at: new Date().toISOString() }).eq('id', consentId)
    return refuse(503, 'The request could not be recorded, so it was withdrawn. Try again.')
  }
  return NextResponse.json({ consentId, tenantId, expiresAt }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
