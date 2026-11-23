/**
 * lib/support/break-glass-actions.ts — the changes break-glass can make (S6-BG, S6-SUP-UI).
 *
 * Each runs ONLY through the tenantDb it is given, which the route opens with
 * tenantBreakGlassDb (lib/tenancy/support-db.ts): tenant_app, pinned to the break-glass
 * session's tenant, under the tenant row policies. Never the service role: a row of
 * another tenant is invisible, so naming one changes nothing.
 *
 * The first is renaming an event's company (a team name), the same write as the
 * 'events-config' area's tenant path (lib/events/admin-config.ts tenantRenameCompany), but
 * returning what it changed. Why a dedicated action and not the companies route itself:
 * that route takes its tenant from the caller's own event scope (requireEventRoute), and a
 * platform admin's scope is Stellr, so opting it in would change how tenant_crew routes
 * resolve their tenant. Here the tenant is the session's and nothing else.
 */
import type { TenantDb } from '@/lib/tenancy/db'

export const COMPANY_NAME_MAX = 80

/** Renames this event's company with this id. Returns the rows changed: 0 when the tenant has no such company. */
export async function renameCompanyUnderBreakGlass(db: TenantDb, eventSlug: string, companyId: string, name: string | null): Promise<number> {
  const rows = await db.sql<{ id: string }>`
    UPDATE public.event_companies SET name = ${name}
    WHERE id = ${companyId}::uuid AND event_slug = ${eventSlug}
    RETURNING id::text AS id`
  return rows.length
}
