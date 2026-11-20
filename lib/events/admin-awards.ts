// The direct table reads behind app/api/admin/events/[slug]/awards, moved here when the route
// became tenant_crew (S5 wave 8, C19b): test/route-manifest.test.ts holds a tenant_crew file
// off a direct .from(). The route answers stellrOnlyEvent first, because an award becomes a
// credential Stellr Education issues, and none is issued for another tenant's event until the
// tenant is the issuer (decision W7-9). So each helper takes a StellrOnlyDb, which only
// stellrOnlyDb hands out, in Stellr's scope.
import type { StellrOnlyDb } from '@/lib/events/admin-records'

/** When the event's awards were last issued, or null. */
export async function awardsIssuedAt(db: StellrOnlyDb, slug: string): Promise<string | null> {
  const { data } = await db.from('event_settings').select('awards_issued_at').eq('event_slug', slug).maybeSingle()
  return ((data as { awards_issued_at?: string | null } | null)?.awards_issued_at as string | null) ?? null
}

/** The event's award assignments table, for the route's draft edits (always filtered by event_slug there). */
export function awardAssignments(db: StellrOnlyDb) {
  return db.from('event_award_assignments')
}
