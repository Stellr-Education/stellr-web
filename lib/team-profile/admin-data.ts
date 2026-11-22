// Team profiles in the event admin: the 'team-profiles' area (multi-tenancy plan S5, A10c,
// which also closes the C18 leftovers). The admin "Team profiles" panel's read, Auto-Assign,
// and the two overrides reach the data through the area switch (lib/tenancy/area-switch.ts),
// as lib/events/admin-config.ts does for 'events-config':
//
//   service  (the default: TENANT_DB_AREAS unset, or TENANT_DB_ENABLED not 'true')
//            today's supabase-js queries, exactly as before (loadCompanyPlan, autoAssign,
//            overrideOutstanding and the participant update). tenantDb is not built, so
//            nothing loads the Postgres client and no connection opens
//   shadow   today's read answers; a sampled share of plan reads also runs the tenantDb read
//            after the response, read-only, and compares the two (below). Writes take the
//            service path alone
//   tenant   the tenantDb read or write answers, pinned to the caller's tenant, under the
//            tenant row level security policies: another tenant's event reads as empty, and
//            a write naming its event or participant changes nothing
//
// The tenant comes from the caller's own scope (requireEventRoute's or requireEventAccess's
// tenantId), never from request input.
//
// What tenant_app can read, and where the tenant path differs from the service path:
//
//   - tenant_app holds SELECT, INSERT, UPDATE and DELETE on team_profiles, registrations,
//     agreements and event_companies, and SELECT plus column UPDATE on participants (every
//     column but member_id and membership_id; the company and override columns are granted).
//   - It holds no grant on members, member_ethnicities or ethnicity_options: those are shared
//     identity (S7). So the tenant path skips the member-profile ethnicity fallback. A
//     student's ethnicity is the participant row's alone.
//   - A student's experience (previous events) counts only this tenant's events: the row
//     policies hide every other tenant's registrations.
//
// Both feed the balancing (Auto-Assign's spread and the best-fit suggestions), so on a Stellr
// event the tenant path can place a student whose ethnicity lives only on their member profile,
// or who came to another tenant's event, differently. The shadow comparison drops what the
// tenant path cannot reproduce (ethnicity, experience, and the suggestions built from them) and
// compares each student on participant id, status, company, locked, overridden and submitted,
// with the companies by id, number and name. The plan is one object, so a mismatch is recorded
// as reason=content with counts of 1, never a row's content.
import type { SupabaseClient } from '@supabase/supabase-js'
import { dataPath, errorCodeOf, readArea, writeArea } from '@/lib/tenancy/area-switch'
import type { TenantDb, TenantQuery } from '@/lib/tenancy/db'
import { updateEventParticipant } from '@/lib/events/admin-config'
import { STUDENT_ROLES } from '@/lib/membership-rules'
import {
  autoAssign,
  buildCompanyPlan,
  loadCompanyPlan,
  planAssignment,
  studentRows,
  type AutoAssignResult,
  type CompanyPlan,
} from './assign'
import { overrideFields, overrideOutstanding, type OverrideActor } from './override'
import { formsCompleteFrom } from './store'

/** The area name in TENANT_DB_AREAS. */
export const TEAM_PROFILES_AREA = 'team-profiles' as const

/**
 * True when this server answers the area through tenantDb. The companies route opens
 * Auto-Assign and the overrides to a tenant's staff only then: on the service path they
 * stay Stellr's (refuseOutsideStellr), as before A10c.
 */
export function teamProfilesOnTenantPath(): boolean {
  return dataPath(TEAM_PROFILES_AREA) === 'tenant'
}

// ── The plan: through the area switch ───────────────────────────────────────

type Raw = Record<string, unknown>

/** A json column, whether the driver parsed it or handed back its text. */
function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

/**
 * The SQL reads behind the tenant path's plan, run in one tenant transaction so they agree
 * with each other. Exported for the two-tenant test, which also runs them as service_role to
 * stand for the service path's filters (CI's database has no PostgREST).
 */
export async function readCompanyPlan(q: Pick<TenantQuery, 'sql'>, slug: string, eventDate: string | null): Promise<CompanyPlan> {
  const companies = await q.sql<{ id: string; number: number; name: string | null }>`
    SELECT id::text AS id, number, name FROM public.event_companies
    WHERE event_slug = ${slug}
    ORDER BY number`
  // Each registration with its participants embedded, in the shape (and the json text forms
  // of timestamps and dates) the service path's embedded select returns.
  const regs = await q.sql<{ id: string; type: string | null; created_at: string; participants: unknown }>`
    SELECT r.id::text AS id, r.type, to_json(r.created_at) #>> '{}' AS created_at,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', p.id, 'member_id', p.member_id, 'first_name', p.first_name, 'last_name', p.last_name,
          'event_role', p.event_role, 'gender', p.gender, 'date_of_birth', p.date_of_birth, 'grade', p.grade,
          'school_name', p.school_name, 'ethnicity', p.ethnicity, 'company_id', p.company_id,
          'company_locked', p.company_locked, 'team_profile_overridden_at', p.team_profile_overridden_at,
          'team_profile_overridden_by_name', p.team_profile_overridden_by_name))
        FROM public.participants p WHERE p.registration_id = r.id), '[]'::json) AS participants
    FROM public.registrations r
    WHERE r.event_slug = ${slug} AND r.status <> 'withdrawn'`
  const profiles = await q.sql<Raw>`
    SELECT participant_id::text AS participant_id, answers,
      to_json(submitted_at) #>> '{}' AS submitted_at, to_json(last_sent_at) #>> '{}' AS last_sent_at,
      send_count, last_send_error
    FROM public.team_profiles
    WHERE event_slug = ${slug}`

  const rows = studentRows(regs.map((r) => ({ ...r, participants: (parsed(r.participants) as Raw[] | null) ?? [] })))

  // Experience: as the service path, but the row policies show only this tenant's events.
  const memberIds = [...new Set(rows.map((r) => r.p.member_id as string | null).filter((x): x is string => !!x))]
  const history = new Map<string, { slug: string; at: string }[]>()
  if (memberIds.length) {
    const past = await q.sql<{ member_id: string; event_slug: string; created_at: string }>`
      SELECT p.member_id::text AS member_id, r.event_slug, to_json(r.created_at) #>> '{}' AS created_at
      FROM public.participants p JOIN public.registrations r ON r.id = p.registration_id
      WHERE p.member_id::text = ANY(${memberIds}::text[])
        AND r.status = 'confirmed' AND r.event_slug <> ${slug}`
    for (const h of past) history.set(h.member_id, [...(history.get(h.member_id) ?? []), { slug: h.event_slug, at: h.created_at }])
  }

  const people = rows.map((r) => ({ id: r.p.id as string, date_of_birth: (r.p.date_of_birth as string | null) ?? null, event_slug: slug }))
  const agreements = people.length
    ? await q.sql<Raw>`
        SELECT participant_id::text AS participant_id, status FROM public.agreements
        WHERE participant_id::text = ANY(${people.map((p) => p.id)}::text[])`
    : []

  return buildCompanyPlan({
    companies,
    rows,
    profiles: profiles.map((p) => ({ ...p, answers: parsed(p.answers) })),
    history,
    // No grant on member_ethnicities (shared identity, S7): the participant row's alone.
    ethnicityByMember: new Map(),
    ready: formsCompleteFrom(agreements, people, new Map([[slug, eventDate]])),
    eventDate,
  })
}

/** The tenantDb read: the event's company plan, under the tenant's row policies. */
export function tenantCompanyPlan(db: TenantDb, slug: string, eventDate: string | null): Promise<CompanyPlan> {
  return db.transaction((q) => readCompanyPlan(q, slug, eventDate))
}

/** What the shadow comparison holds both paths to (see the file header). */
export function comparablePlan(plan: CompanyPlan) {
  return {
    companies: plan.companies
      .map((c) => ({ id: c.id, number: c.number, name: c.name }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    students: plan.students
      .map((s) => ({
        participantId: s.participantId,
        status: s.status,
        companyId: s.companyId,
        locked: s.locked,
        overridden: s.overridden?.at ?? null,
        submitted: s.submittedAt,
      }))
      .sort((a, b) => a.participantId.localeCompare(b.participantId)),
  }
}

/**
 * The admin "Team profiles" panel's plan (the event page's roster tab). Service: today's
 * loadCompanyPlan, which throws on a failed read as before.
 */
export function loadTeamProfilePlan(db: SupabaseClient, tenantId: string, slug: string, eventDate: string | null): Promise<CompanyPlan> {
  return readArea<CompanyPlan, CompanyPlan>(TEAM_PROFILES_AREA, {
    tenantId,
    label: 'GET /admin/competitions/[slug]',
    service: () => loadCompanyPlan(db, slug, eventDate),
    tenant: (tdb) => tenantCompanyPlan(tdb, slug, eventDate),
    normalise: comparablePlan,
  })
}

// ── Auto-Assign and the overrides: through the area switch ──────────────────

/**
 * Auto-Assign through tenantDb: the plan read and every placement in one tenant transaction.
 * Each UPDATE is confined in SQL to this event's participants and, unless it unassigns, this
 * event's company. Throws AssignError as the service path does.
 */
export function tenantAutoAssign(db: TenantDb, slug: string, eventDate: string | null): Promise<AutoAssignResult> {
  return db.transaction(async (q) => {
    const { byCompany, result } = planAssignment(await readCompanyPlan(q, slug, eventDate))
    for (const [companyId, ids] of byCompany) {
      if (!ids.length) continue
      await q.sql`
        UPDATE public.participants p
           SET company_id = ${companyId}::uuid, company_locked = false
          FROM public.registrations r
         WHERE p.id = ANY(${ids}::uuid[])
           AND p.registration_id = r.id
           AND r.event_slug = ${slug}
           AND (${companyId}::uuid IS NULL
                OR EXISTS (SELECT 1 FROM public.event_companies c WHERE c.id = ${companyId}::uuid AND c.event_slug = ${slug}))`
    }
    return result
  })
}

/**
 * POST companies { action: 'auto_assign' }. Service: today's autoAssign. Either path throws
 * AssignError for the route's 400, and any other failure for its 500.
 */
export function autoAssignEvent(db: SupabaseClient, tenantId: string, slug: string, eventDate: string | null): Promise<AutoAssignResult> {
  return writeArea(TEAM_PROFILES_AREA, {
    tenantId,
    service: () => autoAssign(db, slug, eventDate),
    tenant: (tdb) => tenantAutoAssign(tdb, slug, eventDate),
  })
}

/** The override columns, set (overrideFields) or cleared (CLEARED_OVERRIDE). */
export interface OverrideColumns {
  team_profile_overridden_at: string | null
  team_profile_overridden_by: string | null
  team_profile_overridden_by_name: string | null
}

/** The tenantDb write behind override: this event's participant, if the tenant can see it. Returns the rows changed. */
export async function tenantOverrideParticipant(db: TenantDb, slug: string, participantId: string, fields: OverrideColumns): Promise<number> {
  const rows = await db.sql<{ id: string }>`
    UPDATE public.participants p
       SET team_profile_overridden_at = ${fields.team_profile_overridden_at}::timestamptz,
           team_profile_overridden_by = ${fields.team_profile_overridden_by},
           team_profile_overridden_by_name = ${fields.team_profile_overridden_by_name}
      FROM public.registrations r
     WHERE p.id = ${participantId}::uuid
       AND p.registration_id = r.id
       AND r.event_slug = ${slug}
    RETURNING p.id::text AS id`
  return rows.length
}

/**
 * POST companies { action: 'override' }: true unless the write failed. The caller has confined
 * the participant to this event first (AUTH-3). Service: today's update by participant id.
 */
export function overrideParticipant(
  db: SupabaseClient,
  tenantId: string,
  slug: string,
  participantId: string,
  fields: OverrideColumns,
): Promise<boolean> {
  return writeArea(TEAM_PROFILES_AREA, {
    tenantId,
    service: async () => {
      const { error } = await updateEventParticipant(db, participantId, { ...fields })
      return !error
    },
    tenant: async (tdb) => {
      try {
        await tenantOverrideParticipant(tdb, slug, participantId, fields)
        return true
      } catch (err) {
        console.error('[team-profiles] override refused:', errorCodeOf(err))
        return false
      }
    },
  })
}

/**
 * The tenantDb write behind override_all: one UPDATE over this event's students (not withdrawn,
 * in STUDENT_ROLES) who have not submitted a team profile and are not already overridden,
 * exactly the rows overrideOutstanding picks.
 */
export async function tenantOverrideOutstanding(db: TenantDb, slug: string, actor: OverrideActor): Promise<{ overridden: number }> {
  const f = overrideFields(actor)
  const rows = await db.sql<{ id: string }>`
    UPDATE public.participants p
       SET team_profile_overridden_at = ${f.team_profile_overridden_at}::timestamptz,
           team_profile_overridden_by = ${f.team_profile_overridden_by},
           team_profile_overridden_by_name = ${f.team_profile_overridden_by_name}
      FROM public.registrations r
     WHERE p.registration_id = r.id
       AND r.event_slug = ${slug}
       AND r.status IS DISTINCT FROM 'withdrawn'
       AND p.event_role = ANY(${[...STUDENT_ROLES]}::text[])
       AND p.team_profile_overridden_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.team_profiles t
          WHERE t.participant_id = p.id AND t.event_slug = ${slug} AND t.submitted_at IS NOT NULL)
    RETURNING p.id::text AS id`
  return { overridden: rows.length }
}

/** POST companies { action: 'override_all' }. Service: today's overrideOutstanding. Throws on failure. */
export function overrideOutstandingEvent(
  db: SupabaseClient,
  tenantId: string,
  slug: string,
  actor: OverrideActor,
): Promise<{ overridden: number }> {
  return writeArea(TEAM_PROFILES_AREA, {
    tenantId,
    service: () => overrideOutstanding(db, slug, actor),
    tenant: (tdb) => tenantOverrideOutstanding(tdb, slug, actor),
  })
}
