import Link from 'next/link'
import { notFound } from 'next/navigation'
import { assertPlatformAdmin, authz } from '@/lib/authz'
import { listTenants, USAGE_WINDOW_DAYS, type TenantSummary } from '@/lib/console/tenants'
import { supabaseServer } from '@/lib/supabase'
import { TenantStatusBadge } from '@/components/admin/TenantStatusBadge'

export const metadata = { title: 'Admin — Platform' }
export const dynamic = 'force-dynamic'

const ROUTE = '/admin/platform'

// S6-CON: the super-admin console (docs/PLAN-S6-DRAFT.md slice 7). Platform admins
// only, on top of the Stellr admin page guard: anyone else gets a 404. Counts only,
// never a person (lib/console/tenants.ts).
export default async function PlatformConsolePage() {
  await authz.page.requireStellrAdmin({ route: ROUTE })
  if (!(await assertPlatformAdmin({ route: ROUTE })).ok) notFound()
  const tenants = await listTenants(supabaseServer())
  const fmt = (n: number) => n.toLocaleString('en-US')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-ds-h2 text-ink">Platform</h1>
        <p className="mt-0.5 text-sm text-content-muted">
          Every organization on the platform, with counts for the last {USAGE_WINDOW_DAYS} days. People’s details are
          never shown here: open a support session for that.
        </p>
      </div>
      <div className="overflow-x-auto rounded-ds-card border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-content-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-semibold">Organization</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 text-right font-semibold">Sites</th>
              <th className="px-4 py-2 text-right font-semibold">Admins</th>
              <th className="px-4 py-2 text-right font-semibold">Registrations</th>
              <th className="px-4 py-2 text-right font-semibold">Emails</th>
              <th className="px-4 py-2 text-right font-semibold">New events</th>
              <th className="px-4 py-2 text-right font-semibold">New accounts</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t: TenantSummary) => (
              <tr key={t.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <Link href={`/admin/platform/tenants/${t.id}`} className="font-semibold text-primary hover:underline">
                    {t.name}
                  </Link>
                  <span className="ml-2 text-content-muted">{t.slug}</span>
                  {t.isPlatformOwner && <span className="ml-2 text-xs text-content-muted">(platform owner)</span>}
                </td>
                <td className="px-4 py-2">
                  <TenantStatusBadge status={t.status} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(t.hosts)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(t.roles.tenant_admin)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(t.usage.registration)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(t.usage.email)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(t.usage.event)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(t.usage.identity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-content-muted">
        Usage comes from the daily roll-up, which runs only where usage metering is on. Per-organization errors and
        feature switches are not here yet.
      </p>
    </div>
  )
}
