import Link from 'next/link'
import { notFound } from 'next/navigation'
import { assertPlatformAdmin, authz } from '@/lib/authz'
import { loadTenantDetail, USAGE_KINDS, USAGE_WINDOW_DAYS, type UsageKind } from '@/lib/console/tenants'
import { supabaseServer } from '@/lib/supabase'
import { TenantStatusBadge } from '@/components/admin/TenantStatusBadge'
import { TenantStatusControl } from '@/components/admin/TenantStatusControl'
import { TenantErrorsPanel } from '@/components/admin/TenantErrorsPanel'
import { TenantFlagsPanel } from '@/components/admin/TenantFlagsPanel'

export const metadata = { title: 'Admin — Platform organization' }
export const dynamic = 'force-dynamic'

const ROUTE = '/admin/platform/tenants/[id]'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KIND_LABELS: Record<UsageKind, string> = { registration: 'Registrations', event: 'New events', email: 'Emails sent', identity: 'New accounts' }

// S6-CON: one organization in the super-admin console. Platform admins only; counts
// only, never a person (lib/console/tenants.ts).
export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  await authz.page.requireStellrAdmin({ route: ROUTE })
  if (!(await assertPlatformAdmin({ route: ROUTE })).ok) notFound()
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const t = await loadTenantDetail(supabaseServer(), id.toLowerCase())
  if (!t) notFound()
  const fmt = (n: number) => n.toLocaleString('en-US')

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/platform" className="text-sm text-primary hover:underline">
          Platform
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-ds-h2 text-ink">{t.name}</h1>
          <TenantStatusBadge status={t.status} />
        </div>
        <p className="mt-0.5 text-sm text-content-muted">
          {t.slug} · {t.country}
          {t.isPlatformOwner ? ' · platform owner' : ''}
        </p>
      </div>

      <section aria-labelledby="usage-heading" className="rounded-ds-card border border-line bg-white p-5">
        <h2 id="usage-heading" className="font-heading text-ds-h3 text-ink">
          Last {USAGE_WINDOW_DAYS} days
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {USAGE_KINDS.map((k) => (
            <div key={k}>
              <dt className="text-xs text-content-muted">{KIND_LABELS[k]}</dt>
              <dd className="font-display text-ds-h3 tabular-nums text-ink">{fmt(t.usage[k])}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="people-heading" className="rounded-ds-card border border-line bg-white p-5">
          <h2 id="people-heading" className="font-heading text-ds-h3 text-ink">
            Roles
          </h2>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Admins</dt><dd className="tabular-nums">{fmt(t.roles.tenant_admin)}</dd></div>
            <div className="flex justify-between"><dt>Event managers</dt><dd className="tabular-nums">{fmt(t.roles.event_manager)}</dd></div>
            <div className="flex justify-between"><dt>Staff</dt><dd className="tabular-nums">{fmt(t.roles.staff)}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="hosts-heading" className="rounded-ds-card border border-line bg-white p-5">
          <h2 id="hosts-heading" className="font-heading text-ds-h3 text-ink">
            Sites
          </h2>
          {t.hostNames.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {t.hostNames.map((h) => (
                <li key={h} className="font-mono">{h}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-content-muted">No sites.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="support-heading" className="rounded-ds-card border border-line bg-white p-5">
        <h2 id="support-heading" className="font-heading text-ds-h3 text-ink">
          Support
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-content-muted">Open now</dt><dd className="tabular-nums">{fmt(t.support.open)}</dd></div>
          <div><dt className="text-content-muted">Read sessions</dt><dd className="tabular-nums">{fmt(t.support.read)}</dd></div>
          <div><dt className="text-content-muted">Break-glass</dt><dd className="tabular-nums">{fmt(t.support.breakGlass)}</dd></div>
          <div><dt className="text-content-muted">Requests waiting</dt><dd className="tabular-nums">{fmt(t.support.pendingConsents)}</dd></div>
        </dl>
      </section>

      <TenantErrorsPanel tenantId={t.id} isPlatformOwner={t.isPlatformOwner} />
      <TenantFlagsPanel tenantId={t.id} isPlatformOwner={t.isPlatformOwner} />

      {!t.isPlatformOwner && (t.status === 'active' || t.status === 'suspended') && (
        <section aria-labelledby="status-heading" className="rounded-ds-card border border-line bg-white p-5">
          <h2 id="status-heading" className="font-heading text-ds-h3 text-ink">
            {t.status === 'active' ? 'Suspend' : 'Resume'}
          </h2>
          <div className="mt-3">
            <TenantStatusControl tenantId={t.id} tenantName={t.name} status={t.status} />
          </div>
        </section>
      )}
    </div>
  )
}
