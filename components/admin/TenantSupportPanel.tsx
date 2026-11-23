import { auth } from '@clerk/nextjs/server'
import { loadSupportSession } from '@/lib/authz/support-session-server'
import { supportModeEnabled } from '@/lib/authz/support-session'
import { loadOwnConsents } from '@/lib/support/own-consents'
import { TenantSupportActions, type PanelConsent, type PanelSession } from '@/components/admin/TenantSupportActions'

/**
 * S6-SUP-UI: the console's support panel for one organization (a server component; the
 * tenant detail page renders it). Nothing with SUPPORT_MODE_ENABLED off, and nothing for
 * the platform owner, which support mode never reaches.
 *
 * It reads the viewer's OWN break-glass requests for this organization (times and status
 * only, never a reason: the reason is the requester's own text, and another admin's is not
 * theirs to read) and the viewer's open session, verified by loadSupportSession. The
 * actions themselves are the support routes, through TenantSupportActions.
 */
export async function TenantSupportPanel({ tenantId, tenantName, isPlatformOwner }: { tenantId: string; tenantName: string; isPlatformOwner: boolean }) {
  if (!supportModeEnabled() || isPlatformOwner) return null
  const { userId } = await auth()
  if (!userId) return null

  const [session, own] = await Promise.all([loadSupportSession(), loadOwnConsents(tenantId, userId)])
  const consents: PanelConsent[] = own ?? []
  // A session on another organization still blocks opening one here; say which.
  const current: PanelSession | null = session
    ? { mode: session.mode, endsAt: session.endsAt, here: session.tenantId === tenantId, tenantName: session.tenantName }
    : null

  return (
    <section aria-labelledby="support-panel-heading" className="rounded-ds-card border border-line bg-white p-5">
      <h2 id="support-panel-heading" className="font-heading text-ds-h3 text-ink">
        Support access
      </h2>
      <p className="mt-1 text-sm text-content-muted">
        Look at {tenantName}’s data read-only, or, with one of their admins’ approval, make a change. Every step shows on
        their audit log.
      </p>
      <div className="mt-4">
        <TenantSupportActions tenantId={tenantId} session={current} consents={consents} readFailed={own === null} />
      </div>
    </section>
  )
}
