/**
 * lib/app-errors-tenant.ts — which tenant a failed request served (S6-CON-b).
 *
 * Read by instrumentation.ts only, and handed to captureRequestError as its tenantId,
 * so app_errors can be counted per tenant in the super-admin console. Kept out of
 * lib/app-errors.ts because the tenant page tree reaches that file, and a tenant page
 * must never read a tenant header (test/tenant-tree-pages.test.ts).
 *
 * The header is the one the proxy sets on tenant hosts only and strips on every other
 * host (lib/tenancy/host.ts), so a Stellr host answers null. One header read, no lookup:
 * this runs on every server error.
 */
import { cleanTenantId } from '@/lib/app-errors'
import { TENANT_ID_HEADER } from '@/lib/tenancy/host'

type HeaderBag = Headers | Record<string, string | string[] | undefined> | null | undefined

/** The tenant id on a request's headers, a uuid lower-cased, or null. Never throws. */
export function errorTenantId(headers: HeaderBag): string | null {
  if (!headers) return null
  try {
    if (typeof (headers as Headers).get === 'function') return cleanTenantId((headers as Headers).get(TENANT_ID_HEADER))
    return cleanTenantId((headers as Record<string, unknown>)[TENANT_ID_HEADER])
  } catch {
    return null
  }
}
