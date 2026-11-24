import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { assertPlatformAdmin, writeRefusal } from '@/lib/authz'
import { requireStrictStepUp } from '@/lib/authz/step-up'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation } from '@/lib/audit/route'
import { supabaseServer } from '@/lib/supabase'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { createDomain, getDomain, removeDomain, ResendDomainError, verifyDomain } from '@/lib/email/resend-domains'
import { checkSenderFields, checkSendingDomain, domainLimit, loadTenantEmailSettings, type TenantEmailSettings } from '@/lib/email/tenant-settings'

// Email plan D2: a tenant's sender and own sending domain, from the super-admin console.
//
// POST { action } on the platform host:
//   save          { from_name?, from_local_part?, reply_to?, bulk_daily_cap?, bulk_monthly_cap? }
//                 who the mail is from, where replies go, and caps on its event blasts (plan E)
//   pause_bulk    { reason? }  stops the tenant's event blasts (plan E); one-to-one mail still goes
//   resume_bulk   —            lets them go again
//   add_domain    { domain }   adds it to Resend; the panel shows the DNS records to send the tenant
//   check         —            asks Resend to check the records, then stores the status
//   remove_domain —            back to "<Tenant> via Stellr", and the domain leaves Resend
//
// The tenant's mail switches to its own domain only once Resend reports it verified
// (lib/event-emails/tenant-mail.ts). Guards as the flags route: a tenant host gets 404,
// platform admins only, strict step-up, never the platform owner (Stellr's domains are
// managed in Resend directly), and every change goes on the tenant's audit chain or is undone.

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/platform/tenants/[id]/email'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = ['save', 'add_domain', 'check', 'remove_domain', 'pause_bulk', 'resume_bulk'] as const
type Action = (typeof ACTIONS)[number]

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

type Patch = Partial<Omit<TenantEmailSettings, 'tenant_id'>>

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (await onTenantHost()) return refuse(404, 'Not found')
  const { userId } = await auth()
  if (!userId || !(await assertPlatformAdmin({ route: ROUTE })).ok) return refuse(403, 'Forbidden')
  const refused = writeRefusal(req)
  if (refused) return refused
  const stepUp = await requireStrictStepUp()
  if (stepUp) return stepUp
  if (!auditEnabled()) return refuse(503, 'Changing a tenant’s email needs the platform audit log (PLATFORM_AUDIT_ENABLED).')

  const { id } = await ctx.params
  if (!UUID.test(id)) return refuse(404, 'Tenant not found')
  const tenantId = id.toLowerCase()
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!(ACTIONS as readonly unknown[]).includes(b.action)) return refuse(400, `action must be one of: ${ACTIONS.join(', ')}`)
  const action = b.action as Action

  const db = supabaseServer()
  const { data: tenant, error: readError } = await db.from('tenants').select('id, is_platform_owner').eq('id', tenantId).maybeSingle()
  if (readError) return refuse(503, 'Could not load the tenant.')
  if (!tenant) return refuse(404, 'Tenant not found')
  if ((tenant as { is_platform_owner: boolean }).is_platform_owner) {
    return refuse(403, 'Stellr’s own sending domains are managed in Resend, not here.', 'platform_owner')
  }

  let previous: TenantEmailSettings | null
  try {
    previous = await loadTenantEmailSettings(db, tenantId)
  } catch {
    return refuse(503, 'Could not read the tenant’s email settings.')
  }

  // Work out the change. `afterAudit` runs only once the change is on the audit chain;
  // `undoProvider` runs if it is not, to take back anything done at Resend.
  let patch: Patch
  let afterAudit: (() => Promise<void>) | null = null
  let undoProvider: (() => Promise<void>) | null = null
  const now = new Date().toISOString()

  try {
    if (action === 'save') {
      const checked = checkSenderFields(b)
      if (!checked.ok) return refuse(400, checked.error)
      if (!Object.keys(checked.value).length) return refuse(400, 'Nothing to change.')
      patch = checked.value
    } else if (action === 'add_domain') {
      if (previous?.sending_domain) return refuse(409, 'This tenant already has a sending domain. Remove it first.')
      const checked = checkSendingDomain(b.domain)
      if (!checked.ok) return refuse(400, checked.error)
      const { count, error: countError } = await db.from('tenant_email_settings').select('tenant_id', { count: 'exact', head: true }).not('sending_domain', 'is', null)
      if (countError) return refuse(503, 'Could not count the domains in use.')
      const { limit, platform } = domainLimit()
      if ((count ?? 0) + platform >= limit) {
        return refuse(409, `The Resend plan allows ${limit} domains and all of them are in use.`, 'domain_limit')
      }
      const { data: taken } = await db.from('tenant_email_settings').select('tenant_id').eq('sending_domain', checked.value).maybeSingle()
      if (taken) return refuse(409, 'Another tenant already uses that domain.')
      const domain = await createDomain(checked.value)
      undoProvider = () => removeDomain(domain.id)
      patch = { sending_domain: checked.value, resend_domain_id: domain.id, domain_status: domain.status, forge_status: 'off', domain_checked_at: now }
    } else if (action === 'pause_bulk') {
      if (previous?.bulk_paused_at) return refuse(409, 'This tenant’s event blasts are already paused.')
      const reason = typeof b.reason === 'string' ? b.reason.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
      patch = { bulk_paused_at: now, paused_reason: reason || null }
    } else if (action === 'resume_bulk') {
      if (!previous?.bulk_paused_at) return refuse(409, 'This tenant’s event blasts aren’t paused.')
      patch = { bulk_paused_at: null, paused_reason: null }
    } else if (action === 'check') {
      if (!previous?.resend_domain_id) return refuse(409, 'This tenant has no sending domain to check.')
      await verifyDomain(previous.resend_domain_id)
      const domain = await getDomain(previous.resend_domain_id)
      patch = { domain_status: domain.status, domain_checked_at: now }
    } else {
      if (!previous?.sending_domain) return refuse(409, 'This tenant has no sending domain.')
      const resendId = previous.resend_domain_id
      patch = { sending_domain: null, resend_domain_id: null, domain_status: 'none', forge_status: 'off', domain_checked_at: null }
      // Removed at Resend only once the tenant's mail has moved back and the change is recorded.
      if (resendId) {
        afterAudit = async () => {
          try {
            await removeDomain(resendId)
          } catch (err) {
            if (!(err instanceof ResendDomainError && err.status === 404)) {
              console.error(`[platform-email] domain ${resendId} stayed in Resend:`, err instanceof Error ? err.message : err)
            }
          }
        }
      }
    }
  } catch (err) {
    const status = err instanceof ResendDomainError ? err.status : 0
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[platform-email] ${action} for tenant ${tenantId} failed at Resend:`, message)
    return refuse(status === 422 || status === 400 ? 400 : 502, `Resend refused it: ${message}`)
  }

  const { error: writeError } = await db
    .from('tenant_email_settings')
    .upsert({ tenant_id: tenantId, ...patch, updated_at: now, updated_by: userId }, { onConflict: 'tenant_id' })
  if (writeError) {
    if (undoProvider) await undoProvider().catch(() => {})
    return refuse(503, 'Could not save the change.')
  }

  const audited = await auditMutation(
    {
      action: `platform.tenant_email.${action}` as const,
      actor: { userId },
      tenant: { tenantId },
      target: { table: 'tenant_email_settings', id: tenantId },
      reason: 'platform_console',
      metadata: { change: patch, previous: previous ? Object.fromEntries(Object.keys(patch).map((k) => [k, previous![k as keyof TenantEmailSettings] ?? null])) : null },
    },
    { afterResponse: false },
  )
  if (!audited.ok) {
    // A change the tenant cannot see on its audit page must not stand.
    if (previous) {
      const restore = Object.fromEntries(Object.keys(patch).map((k) => [k, previous![k as keyof TenantEmailSettings] ?? null]))
      await db.from('tenant_email_settings').update(restore).eq('tenant_id', tenantId)
    } else {
      await db.from('tenant_email_settings').delete().eq('tenant_id', tenantId)
    }
    if (undoProvider) await undoProvider().catch(() => {})
    return refuse(503, 'The change could not be recorded, so it was undone. Try again.')
  }
  if (afterAudit) await afterAudit()
  return NextResponse.json({ tenantId, action, settings: { ...(previous ?? {}), ...patch } }, { headers: { 'Cache-Control': 'no-store' } })
}
