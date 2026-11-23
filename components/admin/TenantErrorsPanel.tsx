import { ERROR_WINDOW_DAYS, loadTenantErrors } from '@/lib/console/tenants'
import { supabaseServer } from '@/lib/supabase'

/**
 * S6-CON-b: the errors an organization's sites raised in the last week, for the
 * super-admin console. Route patterns and counts only, never an error message.
 * Rendered only on a page that has already checked assertPlatformAdmin.
 */
export async function TenantErrorsPanel({ tenantId, isPlatformOwner }: { tenantId: string; isPlatformOwner: boolean }) {
  const errors = await loadTenantErrors(supabaseServer(), tenantId)
  const fmt = (n: number) => n.toLocaleString('en-US')
  return (
    <section aria-labelledby="errors-heading" className="rounded-ds-card border border-line bg-white p-5">
      <h2 id="errors-heading" className="font-heading text-ds-h3 text-ink">
        Errors, last {ERROR_WINDOW_DAYS} days
      </h2>
      {isPlatformOwner ? (
        <p className="mt-3 text-sm text-content-muted">Errors on Stellr’s own sites are in the daily error email, not counted here.</p>
      ) : errors.distinct === 0 ? (
        <p className="mt-3 text-sm text-content-muted">None.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink">
            {fmt(errors.distinct)} distinct {errors.distinct === 1 ? 'error' : 'errors'}, {fmt(errors.total)} times in all.
          </p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-content-muted">
              <tr className="border-b border-line">
                <th className="py-1 font-semibold">Route</th>
                <th className="py-1 text-right font-semibold">Times</th>
              </tr>
            </thead>
            <tbody>
              {errors.topRoutes.map((r) => (
                <tr key={r.route} className="border-b border-line last:border-0">
                  <td className="py-1 font-mono">{r.route}</td>
                  <td className="py-1 text-right tabular-nums">{fmt(r.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
