import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from './constants'

// Limits a Stellr-only cron to Stellr's rows (S5 B11; lib/cron-scope.ts).
//
// NULL counts as Stellr. Rows the backfill has not reached have no tenant_id yet,
// and they are Stellr's, because no other tenant has ever existed. A strict
// tenant_id = Stellr would hide them from these crons, so with Stellr as the only
// tenant this filter matches every row and each query returns what it returns
// without it.
//
// Only for a table with its own tenant_id column: derived or own in
// lib/tenancy/registry.ts. PostgREST answers an error for a column that does not
// exist, so a via_parent table (participants, until C0b) is reached through its
// filtered parent instead.
//
// Not to be confused with stellrScope() in lib/tenancy/scope-context.ts, which
// builds a ScopeContext for loadScoped.

/** PostgREST `or` value: this table's row is Stellr's, or has no tenant yet. */
export const STELLR_OR_NULL = `tenant_id.is.null,tenant_id.eq.${STELLR_TENANT_ID}`

/** Narrows a query to Stellr's rows and rows with no tenant yet. */
export function stellrRows<Q extends { or(filters: string): Q }>(query: Q): Q {
  return query.or(STELLR_OR_NULL)
}

/**
 * PostgREST `or` value for one tenant's rows in a per-tenant cron (S5 B22): for
 * Stellr, its own rows and rows with no tenant yet; for any other tenant, exactly
 * its own.
 */
export function tenantRowsOr(tenantId: string): string {
  return tenantId === STELLR_TENANT_ID ? STELLR_OR_NULL : `tenant_id.eq.${tenantId}`
}

/**
 * The rows that are this tenant's, NULL counting as Stellr's. A belt to the read's
 * filter: a row of any other tenant that reaches it anyway is left out. A row
 * read without the column throws rather than be filed under Stellr.
 */
export function rowsOfTenant<T extends { tenant_id: string | null }>(rows: readonly T[], tenantId: string): T[] {
  return rows.filter((row) => {
    if (row.tenant_id === undefined) throw new Error('rowsOfTenant: row has no tenant_id; select the column')
    return (row.tenant_id ?? STELLR_TENANT_ID) === tenantId
  })
}

const EVENTS_PAGE = 1000

export interface OtherTenantEvents {
  slugs: Set<string>
  /** Sanity document ids. Unlike a slug, these do not change when an event is renamed. */
  sanityIds: Set<string>
}

/**
 * The events another tenant owns, from the events mirror. An event with no mirror
 * row is not listed: Sanity is the source of truth, the mirror follows it, and
 * today every Sanity event is Stellr's. So a tenant's mirror row has to exist before
 * its Sanity document is first published (docs/TENANCY-S5.md, "Stellr-only crons").
 *
 * Pages until a page comes back empty, because PostgREST shortens a result to its
 * row cap without an error and a shorter list would let a tenant's event through.
 * Throws on a failed read, so that a caller cannot mistake it for "no other tenant
 * has events".
 */
export async function otherTenantEvents(db: SupabaseClient): Promise<OtherTenantEvents> {
  const found: OtherTenantEvents = { slugs: new Set(), sanityIds: new Set() }
  for (let from = 0; ; ) {
    const { data, error } = await db
      .from('events')
      .select('id, slug, sanity_id')
      .neq('tenant_id', STELLR_TENANT_ID)
      .order('id')
      .range(from, from + EVENTS_PAGE - 1)
    if (error) throw new Error(`Reading the events mirror failed: ${error.message}`)
    const page = (data ?? []) as Array<{ slug: string; sanity_id: string }>
    if (page.length === 0) return found
    for (const event of page) {
      found.slugs.add(event.slug)
      found.sanityIds.add(event.sanity_id)
    }
    from += page.length
  }
}
