// The tables behind app/api/admin/events/[slug]/check-in, the admin check-in desk, reached
// through here since the route became tenant_crew (S5 wave 8, C19c): test/route-manifest.test.ts
// holds a tenant_crew file off a direct .from(). The desk stays Stellr-only for now (decision
// WD-C19-DESK, 20 Nov 2026): the route answers stellrOnlyEvent first, and a tenant's own desk
// follows in S8 with tenant event operations, when these reads move to loadScoped. So the one
// helper takes a StellrOnlyDb, which only stellrOnlyDb hands out, in Stellr's scope.
import type { StellrOnlyDb } from '@/lib/events/admin-records'

export type DeskTable = 'event_settings' | 'members' | 'participants' | 'registration_addons' | 'registrations' | 'store_order_items'

/** A query on one of the desk's tables, in Stellr's scope only. */
export function deskTable(db: StellrOnlyDb, table: DeskTable) {
  return db.from(table)
}
