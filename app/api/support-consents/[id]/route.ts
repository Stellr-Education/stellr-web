import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { api } from '@/lib/authz'
import { supportModeEnabled } from '@/lib/authz/support-session'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation } from '@/lib/audit/route'
import { refusalOf, refusalResponse } from '@/lib/support/break-glass'
import { supabaseServer } from '@/lib/supabase'
import { requestTenant } from '@/lib/tenancy/request-tenant'

// S6-BG: a tenant's admin answers a break-glass request (docs/S6-DESIGN.md section 3,
// S6-Q4: in-app approval by one of the tenant's admins, logged to the tenant's chain).
//
// POST { decision: 'approve' | 'decline' } on the TENANT's own host. The tenant is the
// host's, never the caller's choice; a request for another tenant answers 404.
//
// Two checks, both required:
//   - requireTenantCrew(host tenant, ['tenant_admin']), the tenant_crew class's guard;
//   - support_consent_decide in the database, which reads tenant_memberships itself
//     whatever AUTHZ_SOURCE says, and refuses any platform admin. Under
//     AUTHZ_SOURCE=postgres requireTenantCrew lets a platform admin reach every
//     tenant; the platform must never be able to consent on a tenant's behalf.
//
// 404 when SUPPORT_MODE_ENABLED is off or on the platform host (Stellr is the platform
// owner, which break-glass never reaches). With the audit log off the answer is 503:
// consent the tenant cannot see on its audit page must not exist. An approval whose
// audit write fails is withdrawn.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** The host's tenant id, or null on the platform host, with the flag off, or on a lookup failure. */
async function hostTenant(): Promise<string | null> {
  if (!supportModeEnabled()) return null
  try {
    const t = await requestTenant()
    return t.kind === 'tenant' ? t.tenantId : null
  } catch {
    return null
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const tenantId = await hostTenant()
  if (!tenantId) return refuse(404, 'Not found')
  const { userId } = await auth()
  if (!userId) return refuse(401, 'Unauthorised')
  const crew = await api.requireTenantCrew(tenantId, ['tenant_admin'])
  if (!crew.ok) return crew.deny
  if (!auditEnabled()) return refuse(503, 'This needs the audit log, which is off.')

  const { id } = await ctx.params
  if (!UUID.test(id)) return refuse(404, 'Not found')
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (b.decision !== 'approve' && b.decision !== 'decline') return refuse(400, "decision must be 'approve' or 'decline'")
  const approve = b.decision === 'approve'
  const consentId = id.toLowerCase()

  const db = supabaseServer()
  const { error } = await db.rpc('support_consent_decide', { p_consent_id: consentId, p_tenant_id: tenantId, p_approver: userId, p_approve: approve })
  if (error) {
    const code = refusalOf(error)
    if (code === 'consent_not_found') return refusalResponse(code, 404)
    if (code === 'consent_not_tenant_admin' || code === 'consent_platform_admin') return refusalResponse(code, 403)
    if (code === 'consent_decided' || code === 'consent_lapsed') return refusalResponse(code, 409)
    return refuse(503, 'Could not record your answer.')
  }

  const audited = await auditMutation(
    {
      action: approve ? 'support.consent.approve' : 'support.consent.decline',
      actor: { userId },
      tenant: { tenantId },
      target: { table: 'support_consents', id: consentId },
      reason: 'break_glass',
    },
    { afterResponse: false },
  )
  if (!audited.ok && approve) {
    await db.rpc('support_consent_withdraw', { p_consent_id: consentId, p_tenant_id: tenantId })
    return refuse(503, 'Your approval could not be recorded, so it was withdrawn. Try again.')
  }
  return NextResponse.json({ consentId, decision: b.decision }, { headers: { 'Cache-Control': 'no-store' } })
}
