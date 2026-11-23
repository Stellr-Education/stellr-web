/**
 * lib/support/own-consents.ts — a platform admin's own break-glass requests for one
 * tenant, for the console's support panel (S6-SUP-UI).
 *
 * Times and status only, never a reason (the requester's own text, and another admin's is
 * not theirs to read), and only rows this admin made for this tenant. support_consents is
 * service_role only by design, so this reads with the service client; the caller has
 * already checked the viewer is a platform admin.
 */
import { supabaseServer } from '@/lib/supabase'
import { consentStatus, type ConsentStatus, type ConsentTimes } from '@/lib/support/consent-status'

export interface OwnConsent {
  id: string
  requestedAt: string
  expiresAt: string
  status: ConsentStatus
}

/** The latest 10, newest first, or null when the read fails. */
export async function loadOwnConsents(tenantId: string, platformAdminUserId: string, now: number = Date.now()): Promise<OwnConsent[] | null> {
  const { data, error } = await supabaseServer()
    .from('support_consents')
    .select('id, requested_at, expires_at, approved_at, declined_at, withdrawn_at, used_at')
    .eq('tenant_id', tenantId)
    .eq('platform_admin_user_id', platformAdminUserId)
    .order('requested_at', { ascending: false })
    .limit(10)
  if (error) return null
  return ((data ?? []) as (ConsentTimes & { id: string; requested_at: string })[]).map((c) => ({
    id: c.id,
    requestedAt: c.requested_at,
    expiresAt: c.expires_at,
    status: consentStatus(c, now),
  }))
}
