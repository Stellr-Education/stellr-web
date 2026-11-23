/**
 * lib/tenancy/tenant-flags.ts — per-tenant switches (S6-CON-b, docs/PLAN-S6-DRAFT.md slice 7).
 *
 * One entry per flag: its default and what it does. public.tenant_feature_flags holds a
 * row only where a tenant differs from the default, and its CHECK lists exactly these
 * names (supabase/migrations/20261123160450_console_tenant_errors_flags.sql), so a flag
 * is added in both places at once. Set from the super-admin console
 * (app/api/admin/platform/tenants/[id]/flags); the platform owner has none.
 *
 * A flag here must have a reader. One that nothing consults is a promise the code does
 * not keep.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const TENANT_FLAGS = {
  break_glass_allowed: {
    default: true,
    label: 'Allow break-glass requests',
    description:
      'Platform staff may ask this organization for break-glass access. Off, every request is refused before it reaches the organization’s admins.',
    reader: 'app/api/admin/support/consent/route.ts',
  },
} as const satisfies Record<string, { default: boolean; label: string; description: string; reader: string }>

export type TenantFlag = keyof typeof TENANT_FLAGS
export const TENANT_FLAG_NAMES = Object.keys(TENANT_FLAGS) as TenantFlag[]

export function isTenantFlag(name: unknown): name is TenantFlag {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TENANT_FLAGS, name)
}

export class TenantFlagReadError extends Error {
  constructor(flag: string) {
    super(`Could not read the ${flag} flag.`)
    this.name = 'TenantFlagReadError'
  }
}

/**
 * The flag's value for a tenant: its row, or the default when there is none. Throws
 * TenantFlagReadError when the read fails, so a caller decides whether to fail closed.
 */
export async function tenantFlag(db: SupabaseClient, tenantId: string, flag: TenantFlag): Promise<boolean> {
  const { data, error } = await db.from('tenant_feature_flags').select('enabled').eq('tenant_id', tenantId).eq('flag', flag).maybeSingle()
  if (error) throw new TenantFlagReadError(flag)
  return data ? Boolean((data as { enabled: boolean }).enabled) : TENANT_FLAGS[flag].default
}

/** Every flag's value for a tenant, defaults filled in. Throws TenantFlagReadError on a failed read. */
export async function tenantFlags(db: SupabaseClient, tenantId: string): Promise<Record<TenantFlag, boolean>> {
  const { data, error } = await db.from('tenant_feature_flags').select('flag, enabled').eq('tenant_id', tenantId)
  if (error) throw new TenantFlagReadError('tenant')
  const out = Object.fromEntries(TENANT_FLAG_NAMES.map((f) => [f, TENANT_FLAGS[f].default])) as Record<TenantFlag, boolean>
  for (const row of (data ?? []) as { flag: string; enabled: boolean }[]) if (isTenantFlag(row.flag)) out[row.flag] = Boolean(row.enabled)
  return out
}
