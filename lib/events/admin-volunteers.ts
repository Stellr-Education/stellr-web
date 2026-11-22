// An event's volunteer interest: the 'volunteers' area (multi-tenancy plan S5, A10c).
//
// The admin read behind GET events/[slug]/volunteers: who raised a hand to support this
// event (volunteer_event_interest, status 'interested'), oldest first. It keeps today's
// supabase-js query as its service path, unchanged, beside a tenantDb read written to
// return the same rows (lib/tenancy/area-switch.ts):
//
//   service  (the default: TENANT_DB_AREAS unset, or TENANT_DB_ENABLED not 'true')
//            today's query, exactly as before, with its embedded members join. tenantDb
//            is not built, so nothing loads the Postgres client and no connection opens
//   shadow   today's query answers; a sampled share of reads also runs the tenantDb read
//            after the response, read-only, and records a difference by count and
//            member uuid only
//   tenant   the tenantDb read answers, pinned to the caller's tenant, under the tenant
//            row level security policies: another tenant's event reads as empty
//
// What the tenant path cannot reproduce. tenant_app holds SELECT, INSERT, UPDATE and DELETE
// on volunteer_event_interest and no grant on members (that is S7), so the tenantDb read
// returns member_id and created_at only, with no embedded `members`. The shadow comparison
// therefore drops `members` from the service rows (`normalise`), and the mismatch key is the
// row's member_id, a uuid: never a name or an email. The route fills the names in tenant
// mode from Stellr's own service-role client (withVolunteerMembers in admin-records.ts),
// which it may only hold in Stellr's scope.
//
// The tenant comes from the caller's own scope (requireEventRoute's tenantId), never from
// request input.
//
// Not in the area, and why:
//   - Assigning and removing a volunteer (POST and DELETE on the same route) write
//     cohort_members, event_participations, member roles, Spaces and the Volunteer
//     Agreement: Stellr's mentoring containers, shared members and Stellr's signing
//     accounts. They never write volunteer_event_interest, so there is no admin write on
//     this table to move. They stay Stellr-only (refuseOutsideStellr).
//   - The member's own "I'm interested" submit (app/api/volunteer/interest) stays on the
//     service path. It is a member acting for themselves, not tenant staff, and since A10b
//     it writes only Stellr's events (another tenant's event answers 404), so its tenant is
//     always Stellr's and a tenant path would prove nothing new.
//   - Stellr-wide reads with no event (the admin Volunteers console, the Friday digest)
//     are not event-scoped and stay on the service path.
import type { SupabaseClient } from '@supabase/supabase-js'
import { errorCodeOf, readArea } from '@/lib/tenancy/area-switch'
import type { TenantDb } from '@/lib/tenancy/db'

/** The area name in TENANT_DB_AREAS. */
export const VOLUNTEERS_AREA = 'volunteers' as const

/** The member columns today's read embeds. The tenant path cannot read them (no grant on members). */
export const VOLUNTEER_MEMBER = 'members(id, first_name, last_name, email, date_of_birth)'

export interface VolunteerMemberEmbed {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  date_of_birth: string | null
}

/**
 * One interest row as the route reads it. `members` is present on the service path (the
 * embed, which supabase-js may hand back as an object or an array) and absent on the
 * tenant path.
 */
export interface EventVolunteerInterestRow {
  member_id: string
  created_at: string
  members?: VolunteerMemberEmbed | VolunteerMemberEmbed[] | null
}

/** The tenantDb read: this event's open interest, oldest first, without member details. */
export async function tenantEventVolunteerInterest(db: TenantDb, slug: string): Promise<EventVolunteerInterestRow[]> {
  const rows = await db.sql<{ member_id: string; created_at: Date | string }>`
    SELECT v.member_id::text AS member_id, v.created_at
    FROM public.volunteer_event_interest v
    WHERE v.event_slug = ${slug} AND v.status = 'interested'
    ORDER BY v.created_at ASC`
  return rows.map((r) => ({ member_id: r.member_id, created_at: new Date(r.created_at).toISOString() }))
}

/** What the shadow comparison holds both paths to: the columns the tenant path can read. */
export const compareInterest = {
  key: (r: EventVolunteerInterestRow) => r.member_id,
  normalise: (r: EventVolunteerInterestRow) => ({ member_id: r.member_id, created_at: r.created_at }),
}

/**
 * GET volunteers: who raised interest in this event. Service: today's query, and like today
 * a failed read answers as no rows. Tenant and shadow: see the file header.
 */
export function loadEventVolunteerInterest(db: SupabaseClient, tenantId: string, slug: string): Promise<EventVolunteerInterestRow[]> {
  return readArea<EventVolunteerInterestRow[], EventVolunteerInterestRow>(VOLUNTEERS_AREA, {
    tenantId,
    label: 'GET /api/admin/events/[slug]/volunteers',
    ...compareInterest,
    service: async () => {
      const { data } = await db
        .from('volunteer_event_interest')
        .select(`member_id, created_at, ${VOLUNTEER_MEMBER}`)
        .eq('event_slug', slug)
        .eq('status', 'interested')
        .order('created_at', { ascending: true })
      return (data ?? []) as unknown as EventVolunteerInterestRow[]
    },
    tenant: (tdb) => tenantEventVolunteerInterest(tdb, slug),
  })
}

/**
 * A SQLSTATE or an error class name for the log, never the message (it can carry values).
 * Re-exported for the route, which reaches the area switch only through this module.
 */
export { errorCodeOf }
