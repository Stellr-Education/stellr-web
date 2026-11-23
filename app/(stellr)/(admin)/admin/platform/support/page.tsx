import Link from 'next/link'
import { notFound } from 'next/navigation'
import { assertPlatformAdmin, authz } from '@/lib/authz'
import { loadSupportSession } from '@/lib/authz/support-session-server'
import { supportModeEnabled } from '@/lib/authz/support-session'
import { supportEventCompanies, supportEvents, type SupportEventRow } from '@/lib/support/read-view'
import { tenantSupportDb } from '@/lib/tenancy/support-db'
import { SupportCompanyRename } from '@/components/admin/SupportCompanyRename'

export const metadata = { title: 'Admin — Support view' }
export const dynamic = 'force-dynamic'

const ROUTE = '/admin/platform/support'

// S6-SUP-UI: what a support session sees of its tenant. Platform admins only (404
// otherwise), and only inside a verified session (loadSupportSession). Every read goes
// through tenantSupportDb (tenant_support_ro, READ ONLY, pinned to the session's tenant):
// never the service client, so no fallback can show another tenant's rows.
export default async function SupportViewPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  await authz.page.requireStellrAdmin({ route: ROUTE })
  if (!(await assertPlatformAdmin({ route: ROUTE })).ok) notFound()
  if (!supportModeEnabled()) notFound()

  const session = await loadSupportSession()
  if (!session) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-ds-h2 text-ink">Support view</h1>
        <p className="text-sm text-content-muted">
          You don’t have a support session open. Open one from an organization’s page under{' '}
          <Link href="/admin/platform" className="text-primary hover:underline">
            Platform
          </Link>
          , with a reason. It lasts up to an hour and the organization sees it on its audit log.
        </p>
      </div>
    )
  }

  const { event } = await searchParams
  let events: SupportEventRow[] = []
  let companies: Awaited<ReturnType<typeof supportEventCompanies>> | null = null
  let failed = false
  try {
    const db = tenantSupportDb(session)
    events = await supportEvents(db)
    const chosen = event && events.find((e) => e.slug === event)
    if (chosen) companies = await supportEventCompanies(db, chosen.slug)
  } catch {
    // Unconfigured (TENANT_DB_ENABLED or its URL) or refused: say so, never fall back.
    failed = true
  }
  const fmt = (n: number) => n.toLocaleString('en-US')
  const breakGlass = session.mode === 'break_glass'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-ds-h2 text-ink">Support view: {session.tenantName}</h1>
        <p className="mt-0.5 text-sm text-content-muted">
          {breakGlass
            ? 'Break-glass is open. Changes you make here are recorded on the organization’s audit log.'
            : 'Read-only. Nothing here can be changed.'}
        </p>
      </div>
      {failed ? (
        <p role="alert" className="rounded-ds-card border border-danger bg-white p-4 text-sm text-danger">
          The organization’s data can’t be read here: the tenant database connection isn’t set up on this deployment.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-ds-card border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="text-left text-content-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-semibold">Event</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Starts</th>
                <th className="px-4 py-2 text-right font-semibold">Registrations</th>
                <th className="px-4 py-2 text-right font-semibold">Participants</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-content-muted">
                    No events.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.slug} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${ROUTE}?event=${encodeURIComponent(e.slug)}`} className="font-semibold text-primary hover:underline">
                      {e.title}
                    </Link>
                    <span className="ml-2 text-content-muted">{e.slug}</span>
                  </td>
                  <td className="px-4 py-2">{e.status ?? '—'}</td>
                  <td className="px-4 py-2">{e.startsAt ? e.startsAt.slice(0, 10) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(e.registrations)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(e.participants)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {companies && event && (
        <section aria-labelledby="companies-heading" className="rounded-ds-card border border-line bg-white p-5">
          <h2 id="companies-heading" className="font-heading text-ds-h3 text-ink">
            Companies in {event}
          </h2>
          {companies.length === 0 ? (
            <p className="mt-3 text-sm text-content-muted">No companies.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {companies.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3">
                  <span className="w-28 tabular-nums text-content-muted">
                    Company {c.number} · {fmt(c.participants)}
                  </span>
                  {breakGlass ? (
                    <SupportCompanyRename eventSlug={event} companyId={c.id} name={c.name} />
                  ) : (
                    <span>{c.name ?? '—'}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
