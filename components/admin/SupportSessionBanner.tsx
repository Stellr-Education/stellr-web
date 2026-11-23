import { Badge } from '@stellr/web-ui'
import { SupportSessionEndButton } from '@/components/admin/SupportSessionEndButton'

/**
 * S6-SUP: shown on every admin page while the viewer has an open support session
 * (docs/S6-DESIGN.md section 2). It names the tenant and when the session ends, and says
 * that nothing can be changed. The admin layout passes it a session that
 * lib/authz/support-session-server.ts verified; with SUPPORT_MODE_ENABLED off there is
 * never one, and this never renders.
 */
export function SupportSessionBanner({ tenantName, endsAt }: { tenantName: string; endsAt: number }) {
  const ends = new Date(endsAt)
  const endsLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(ends)
  return (
    <div role="status" aria-live="polite" className="border-b border-pathway-amber bg-pathway-amber-bg">
      <div className="mx-auto flex w-full max-w-chrome flex-wrap items-center gap-3 px-4 py-3 lg:px-8">
        <Badge className="bg-pathway-amber text-ink">Support mode</Badge>
        <p className="min-w-0 flex-1 font-subheading text-sm text-ink">
          You’re viewing <strong className="font-semibold">{tenantName}</strong> as support, read-only. Changes are blocked. The session ends at{' '}
          <time dateTime={ends.toISOString()}>{endsLabel}</time>.
        </p>
        <SupportSessionEndButton />
      </div>
    </div>
  )
}
