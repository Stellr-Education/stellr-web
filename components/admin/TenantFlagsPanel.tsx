import { supabaseServer } from '@/lib/supabase'
import { TENANT_FLAG_NAMES, TENANT_FLAGS, tenantFlags } from '@/lib/tenancy/tenant-flags'
import { TenantFlagToggle } from '@/components/admin/TenantFlagToggle'

/**
 * S6-CON-b: an organization's switches (lib/tenancy/tenant-flags.ts), for the
 * super-admin console. The platform owner has none. Rendered only on a page that has
 * already checked assertPlatformAdmin; each change goes through the flags API, which
 * checks again.
 */
export async function TenantFlagsPanel({ tenantId, isPlatformOwner }: { tenantId: string; isPlatformOwner: boolean }) {
  if (isPlatformOwner) return null
  const values = await tenantFlags(supabaseServer(), tenantId)
  return (
    <section aria-labelledby="flags-heading" className="rounded-ds-card border border-line bg-white p-5">
      <h2 id="flags-heading" className="font-heading text-ds-h3 text-ink">
        Switches
      </h2>
      <ul className="mt-3 space-y-4">
        {TENANT_FLAG_NAMES.map((flag) => (
          <li key={flag}>
            <TenantFlagToggle
              tenantId={tenantId}
              flag={flag}
              label={TENANT_FLAGS[flag].label}
              description={TENANT_FLAGS[flag].description}
              enabled={values[flag]}
              isDefault={values[flag] === TENANT_FLAGS[flag].default}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
