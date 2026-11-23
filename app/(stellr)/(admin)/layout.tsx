import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { ClerkProvider } from '@clerk/nextjs'
import { AdminUserButton } from '@/components/admin/AdminUserButton'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { requestNonce } from '@/lib/request-nonce'
import { adminNeedsSecondFactor, currentCapabilities, hasCapability, hasPortalAccess, isStellrAdmin } from '@/lib/authz'
import { ADMIN_MFA_PAGE } from '@/lib/authz/admin-mfa'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { RecordLinksProvider } from '@/components/admin/RecordLinks'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { SupportSessionBanner } from '@/components/admin/SupportSessionBanner'
import { loadSupportSession } from '@/lib/authz/support-session-server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  // F4 part B (ADMIN_MFA_ENFORCE, off): an admin without a second factor is asked to turn one on.
  if (await adminNeedsSecondFactor()) redirect(ADMIN_MFA_PAGE)

  // Admins see the full portal; Staff read all of it but the pages proxy.ts keeps
  // from them, and change only Competitions and Members (lib/authz/capabilities);
  // Event Managers only the Events section (proxy.ts redirects them elsewhere).
  if (!(await hasPortalAccess({ route: '/admin' }))) redirect('/account')
  const isAdmin = await isStellrAdmin({ route: '/admin' })
  const role = isAdmin ? 'admin' : (await hasCapability('portal:read', { route: '/admin' })) ? 'staff' : 'event_manager'
  const ROLE_LABEL = { admin: 'Admin', staff: 'Staff', event_manager: 'Event Manager' } as const
  // What the viewer may change, so pages can hide the controls the API would
  // refuse them. Hiding only: every route still decides for itself.
  const capabilities = await currentCapabilities()
  // S6-SUP: the banner while a support session is open. Null at once with SUPPORT_MODE_ENABLED off.
  const support = await loadSupportSession()

  // The nonce puts clerk-js under the CSP (lib/csp.ts).
  return (
    <ClerkProvider appearance={clerkAppearance} nonce={await requestNonce()}>
    <div className="min-h-[100svh] bg-brand-canvas">
      <div className="flex">
        <AdminSidebar role={role} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {support && <SupportSessionBanner tenantName={support.tenantName} endsAt={support.endsAt} mode={support.mode} />}
          {/* Slim top strip: role badge + account button */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-brand-border bg-white/85 px-4 py-3 backdrop-blur lg:px-8">
            <span className="rounded-full bg-brand-blue/10 px-2.5 py-0.5 font-subheading text-xs font-semibold text-brand-blue">
              {ROLE_LABEL[role]}
            </span>
            {role === 'staff' && (
              <span className="hidden flex-1 text-xs text-content-muted sm:block">
                You can view the whole portal. Changes are open in Competitions and Members; elsewhere they’re for admins.
              </span>
            )}
            <AdminUserButton />
          </header>

          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 pb-24 lg:px-8 lg:pb-10">
            {/* Names link to member and school records for admins and Staff. */}
            <CapabilitiesProvider capabilities={capabilities}>
              <RecordLinksProvider enabled={role !== 'event_manager'}>{children}</RecordLinksProvider>
            </CapabilitiesProvider>
          </main>

          {/* Footer hidden on mobile — bottom tab bar serves that role */}
          <div className="hidden lg:block">
            <SiteFooter variant="slim" />
          </div>
        </div>
      </div>
    </div>
    </ClerkProvider>
  )
}
