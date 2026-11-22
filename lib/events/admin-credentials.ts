// The queries behind app/api/admin/events/[slug]/credentials, moved here as they were when
// the route became tenant_crew (S5 wave 8, C19a): test/route-manifest.test.ts holds a
// tenant_crew file off a direct .from(). The route answers stellrOnlyEvent first, because a
// credential says Stellr Education issued it and none is issued for another tenant's event
// until the tenant is the issuer (decision W7-9; SQ-16's default: credentials are a tenant
// feature later). So the service helpers take a StellrOnlyDb, which only stellrOnlyDb hands
// out, in Stellr's scope.
//
// ── The 'credentials' area (S5 A10c) ────────────────────────────────────────
// The event-scoped credential ADMIN data moves onto tenantDb through the area switch
// (lib/tenancy/area-switch.ts), as 'events-config' did in C18. Each part keeps today's
// supabase-js query as its service path, unchanged, beside a tenantDb path written to return
// the same rows:
//
//   service  (the default: TENANT_DB_AREAS unset, or TENANT_DB_ENABLED not 'true')
//            today's query, exactly as before. tenantDb is not built, so nothing loads the
//            Postgres client and no connection opens
//   shadow   today's query answers; a sampled share of list reads also runs the tenantDb read
//            after the response, read-only, and records a difference by uuid and count only.
//            Writes take the service path alone
//   tenant   the tenantDb read or write answers, pinned to the caller's tenant, under the
//            tenant row level security policies: another tenant's credential reads as absent,
//            and a write naming it changes nothing
//
// What the area covers:
//   - an event's issued credentials for one audience (listEventCredentials, the GET's list);
//   - a credential's revocation (revokeEventCredential, POST /api/admin/credentials/[id]/revoke);
//   - in tenant mode only, the whole credentials panel for another tenant's staff
//     (loadTenantCredentialPanel): its wording from event_settings, the list, and the
//     checked-in count. The GET answers a tenant's staff only when dataPath('credentials') is
//     'tenant'; on service and shadow they keep stellrOnlyEvent's 503.
//
// The tenant comes from the caller's own scope (requireEventRoute's or requireEventCrew's
// tenantId), never from request input. Every caller has already placed the event, or loaded
// the credential, in that scope.
//
// Members: the service list reads credentials' own columns (CREDENTIAL_COLUMNS) and joins
// nothing, so the tenant path returns the same rows and the shadow comparison needs no
// `normalise`. tenant_app has no grant on members (shared identity, S7), so nothing here joins
// them. The tenant panel's mentor count is 0 by construction: mentors are cohort_members of a
// mentoring_cohorts container, which a CHECK holds to Stellr (mentoring_cohorts_stellr_only),
// and their names come from members, which tenant_app cannot read.
//
// What stays on the service path, and why:
//   - issuing (POST) and the wording (PATCH): Stellr-only for every path. issueCredential refuses
//     another tenant's event (W7-9), and it reads members for the minor facts and the email, so
//     a tenant path would only ever write Stellr's rows. It waits for the tenant-as-issuer
//     decision (SQ-16);
//   - the A10a guards, all kept: recordOnHost on the public routes, the consent-pending
//     exclusion and the issuer check in issueCredential, reinstateCredential's refusal;
//   - credential_events: written only by the public credential page and the pdf/events routes
//     (view and share telemetry), and no admin path reads it. tenant_app's grant on it is
//     unused by this slice;
//   - the public credential page, the badge, card, wallet and pdf rendering, member-facing
//     pages, the revoke route's holder lookup and email (they read members), and the
//     credential settings, registrations and mentor reads Stellr's own GET makes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { dataPath, errorCodeOf, readArea, writeArea } from '@/lib/tenancy/area-switch'
import type { TenantDb } from '@/lib/tenancy/db'
import { CREDENTIAL_COLUMNS, revokeCredential, type CredentialRow } from '@/lib/credentials'
import type { StellrOnlyDb } from '@/lib/events/admin-records'
import { isStellrScope, type ScopeContext } from '@/lib/tenancy/scope-context'

export type CredentialAudience = 'students' | 'mentors'

export interface CredentialSettings {
  credential_title: string | null
  credential_description: string | null
  credential_criteria: string | null
  credential_skills: string[] | null
}

// event_settings columns per audience; the API speaks credential_* for both.
const COLUMNS: Record<CredentialAudience, Record<keyof CredentialSettings, string>> = {
  students: {
    credential_title: 'credential_title',
    credential_description: 'credential_description',
    credential_criteria: 'credential_criteria',
    credential_skills: 'credential_skills',
  },
  mentors: {
    credential_title: 'mentor_credential_title',
    credential_description: 'mentor_credential_description',
    credential_criteria: 'mentor_credential_criteria',
    credential_skills: 'mentor_credential_skills',
  },
}

/** The event's credential wording for one audience, or null when it has no settings row. */
export async function loadCredentialSettings(db: StellrOnlyDb, slug: string, audience: CredentialAudience): Promise<CredentialSettings | null> {
  const cols = COLUMNS[audience]
  const { data } = await db
    .from('event_settings')
    .select(Object.values(cols).join(', '))
    .eq('event_slug', slug)
    .maybeSingle()
  if (!data) return null
  return settingsFrom(data as unknown as Record<string, unknown>, audience)
}

/** One audience's wording from an event_settings row (either path). */
function settingsFrom(row: Record<string, unknown>, audience: CredentialAudience): CredentialSettings {
  const cols = COLUMNS[audience]
  return {
    credential_title:       (row[cols.credential_title] as string | null) ?? null,
    credential_description: (row[cols.credential_description] as string | null) ?? null,
    credential_criteria:    (row[cols.credential_criteria] as string | null) ?? null,
    credential_skills:      (row[cols.credential_skills] as string[] | null) ?? [],
  }
}

/** Save one audience's wording on the event's settings row. */
export async function saveCredentialSettings(db: StellrOnlyDb, slug: string, audience: CredentialAudience, s: CredentialSettings) {
  const cols = COLUMNS[audience]
  const update = {
    event_slug: slug,
    [cols.credential_title]:       s.credential_title,
    [cols.credential_description]: s.credential_description,
    [cols.credential_criteria]:    s.credential_criteria,
    [cols.credential_skills]:      s.credential_skills,
  }
  return db.from('event_settings').upsert(update, { onConflict: 'event_slug' })
}

/** The event credentials issued to one audience: mentors see theirs, students every other. */
export function listIssuedEventCredentials(db: StellrOnlyDb, slug: string, audience: CredentialAudience, columns: string) {
  const issued = db.from('credentials').select(columns).eq('event_slug', slug).eq('source', 'event')
  return (audience === 'mentors' ? issued.eq('award_type', 'mentor') : issued.neq('award_type', 'mentor')).order('recipient_name')
}

/** The event's registrations that have not withdrawn. */
export async function activeRegistrationIds(db: StellrOnlyDb, slug: string): Promise<string[]> {
  const { data } = await db.from('registrations').select('id').eq('event_slug', slug).neq('status', 'withdrawn')
  return (data ?? []).map((r) => r.id as string)
}

/** How many participants on these registrations have been checked in. */
export async function checkedInCount(db: StellrOnlyDb, registrationIds: string[]): Promise<number> {
  if (!registrationIds.length) return 0
  const { count } = await db
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .not('checked_in_at', 'is', null)
    .in('registration_id', registrationIds)
  return count ?? 0
}

export interface CredentialCandidate {
  id: string
  member_id: string | null
  first_name: string
  last_name: string
  email: string
  date_of_birth: string
  event_role: string
  award: string | null
  checked_in_at: string | null
  emergency_contact_first_name: string | null
  emergency_contact_email: string | null
}

/** Everyone on the event's registrations that have not withdrawn, for a participation run. */
export async function credentialCandidates(db: StellrOnlyDb, slug: string): Promise<CredentialCandidate[]> {
  const { data: regs } = await db
    .from('registrations')
    .select('id, participants(id, member_id, first_name, last_name, email, date_of_birth, event_role, award, checked_in_at, emergency_contact_first_name, emergency_contact_email)')
    .eq('event_slug', slug)
    .neq('status', 'withdrawn')
  return (regs ?? []).flatMap((r) => ((r as { participants?: CredentialCandidate[] }).participants as CredentialCandidate[]) ?? [])
}

// ── The 'credentials' area (S5 A10c): see the file header ───────────────────

/** The area name in TENANT_DB_AREAS. */
export const CREDENTIALS_AREA = 'credentials' as const

/** loadTenantCredentialPanel's service side, which must never answer; the route answers it as a 500. */
export class CredentialsReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialsReadError'
  }
}

/** A json column, whether the driver parsed it or handed back its text. */
function asJsonRow<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

// The column lists in the two statements below are CREDENTIAL_COLUMNS written out, in the
// same order, so each statement is fixed text: the unit test holds them to it. They are
// selected through row_to_json, so each value comes back in the JSON form PostgREST gives
// the service path (timestamps as ISO text, a date as YYYY-MM-DD, numeric as a number,
// text[] as an array): the same rows, not just rows equal after normalising.

/**
 * The tenantDb read: an event's issued credentials for one audience, by recipient name.
 * Mentors see the mentor credentials, students every other event credential (as
 * listIssuedEventCredentials: `award_type <> 'mentor'` leaves out a NULL, as PostgREST's neq does).
 */
export async function tenantEventCredentials(
  db: Pick<TenantDb, 'sql'>,
  slug: string,
  audience: CredentialAudience,
): Promise<CredentialRow[]> {
  const rows = await db.sql<{ row: unknown }>`
    SELECT row_to_json(c) AS row FROM (
      SELECT id, number, source, member_id, participant_id, module_id, event_slug, recipient_name, title, description, criteria, skills, issuer, role_label, award, award_type, theme, badge_path, pd_hours, standards, activity_title, activity_date, activity_location, issued_at, expires_at, status, revoked_at, revoked_reason, tombstoned_at, visibility, is_minor
      FROM public.credentials
      WHERE event_slug = ${slug} AND source = 'event'
        AND CASE WHEN ${audience === 'mentors'}::boolean THEN award_type = 'mentor' ELSE award_type <> 'mentor' END
    ) c
    ORDER BY c.recipient_name`
  return rows.map((r) => asJsonRow<CredentialRow>(r.row))
}

/**
 * The GET's list of issued credentials. Service: today's query (listIssuedEventCredentials),
 * and, as today, a failed read answers as an empty list. Tenant: a failed read is the
 * request's failure (no fallback). Shadow: see the file header. The comparison keys on the
 * credential's uuid, so a mismatch never shows a name or a credential number.
 */
export function listEventCredentials(
  db: StellrOnlyDb,
  tenantId: string,
  slug: string,
  audience: CredentialAudience,
): Promise<CredentialRow[]> {
  return readArea<CredentialRow[], CredentialRow>(CREDENTIALS_AREA, {
    tenantId,
    label: 'GET /api/admin/events/[slug]/credentials',
    service: async () => {
      const { data } = await listIssuedEventCredentials(db, slug, audience, CREDENTIAL_COLUMNS)
      return (data ?? []) as unknown as CredentialRow[]
    },
    tenant: (tdb) => tenantEventCredentials(tdb, slug, audience),
  })
}

/** What the credentials panel shows another tenant's staff, in tenant mode. */
export interface TenantCredentialPanel {
  settings: CredentialSettings | null
  credentials: CredentialRow[]
  checkedInCount: number
}

/** The tenantDb reads behind the panel, in one tenant transaction. */
export async function tenantCredentialPanel(
  db: Pick<TenantDb, 'transaction'>,
  slug: string,
  audience: CredentialAudience,
): Promise<TenantCredentialPanel> {
  return db.transaction(async (q) => {
    const [settingsRow] = await q.sql<Record<string, unknown>>`
      SELECT credential_title, credential_description, credential_criteria, credential_skills,
             mentor_credential_title, mentor_credential_description, mentor_credential_criteria, mentor_credential_skills
      FROM public.event_settings WHERE event_slug = ${slug}`
    const credentials = await tenantEventCredentials(q, slug, audience)
    const [counted] = await q.sql<{ n: number | string }>`
      SELECT count(*)::int AS n
      FROM public.participants p JOIN public.registrations r ON r.id = p.registration_id
      WHERE r.event_slug = ${slug} AND r.status <> 'withdrawn' AND p.checked_in_at IS NOT NULL`
    return {
      settings: settingsRow ? settingsFrom(settingsRow, audience) : null,
      credentials,
      checkedInCount: Number(counted?.n ?? 0),
    }
  })
}

/**
 * The credentials panel for another tenant's staff. Called only when
 * dataPath('credentials') is 'tenant' (credentialsOnTenantPath), so the service path never
 * answers: if the switch has moved off tenant in between, it throws CredentialsReadError,
 * and the route answers a 500 rather than read without a tenant filter.
 */
export function loadTenantCredentialPanel(tenantId: string, slug: string, audience: CredentialAudience): Promise<TenantCredentialPanel> {
  return readArea<TenantCredentialPanel>(CREDENTIALS_AREA, {
    tenantId,
    label: 'GET /api/admin/events/[slug]/credentials tenant',
    service: () => Promise.reject(new CredentialsReadError('the credentials panel for a tenant reads through tenantDb only')),
    tenant: (tdb) => tenantCredentialPanel(tdb, slug, audience),
  })
}

/**
 * Does this caller get the tenant panel? Only another tenant's staff, and only while the
 * area is on the tenant path. Pure: it reads the server's flags and the caller's scope,
 * never the database or the request. Stellr's own staff always take the guarded route.
 */
export function credentialsOnTenantPath(scope: Pick<ScopeContext, 'tenantId'>): boolean {
  return !isStellrScope(scope) && dataPath(CREDENTIALS_AREA) === 'tenant'
}

/**
 * The tenantDb write behind revoke: this credential, if it is issued and the tenant can see
 * it. Returns the revoked row (today's columns), or null when nothing matched.
 */
export async function tenantRevokeCredential(
  db: Pick<TenantDb, 'sql'>,
  id: string,
  reason: string,
  revokedBy: string | null,
  now: string,
): Promise<CredentialRow | null> {
  // Visibility is left as it was, as on the service path: a credential public when it was
  // revoked keeps answering "Revoked" at the URL already on LinkedIn.
  const rows = await db.sql<{ row: unknown }>`
    WITH u AS (
      UPDATE public.credentials
         SET status = 'revoked', revoked_at = ${now}::timestamptz, revoked_reason = ${reason},
             revoked_by = ${revokedBy}::uuid, updated_at = ${now}::timestamptz
       WHERE id = ${id}::uuid AND status = 'issued'
      RETURNING id, number, source, member_id, participant_id, module_id, event_slug, recipient_name, title, description, criteria, skills, issuer, role_label, award, award_type, theme, badge_path, pd_hours, standards, activity_title, activity_date, activity_location, issued_at, expires_at, status, revoked_at, revoked_reason, tombstoned_at, visibility, is_minor
    )
    SELECT row_to_json(u) AS row FROM u`
  return rows.length ? asJsonRow<CredentialRow>(rows[0].row) : null
}

/**
 * POST /api/admin/credentials/[id]/revoke: the revoked row, or null when it was not revoked
 * (already revoked, or not this tenant's), which the route answers as today's 409. The caller
 * loaded the credential in its scope first (loadEventRecord). Service: today's
 * revokeCredential, whose failed write also reads as null; the tenant path matches that, and
 * logs the error code (a SQLSTATE or class name, never the message).
 */
export function revokeEventCredential(
  db: SupabaseClient,
  tenantId: string,
  id: string,
  reason: string,
  revokedBy: string | null,
): Promise<CredentialRow | null> {
  return writeArea(CREDENTIALS_AREA, {
    tenantId,
    service: () => revokeCredential(db, id, reason, revokedBy),
    tenant: async (tdb) => {
      try {
        return await tenantRevokeCredential(tdb, id, reason, revokedBy, new Date().toISOString())
      } catch (err) {
        console.error('[credentials] revoke refused:', errorCodeOf(err))
        return null
      }
    },
  })
}

/**
 * A SQLSTATE or an error class name for the log, never the message (it can carry values).
 * Re-exported for the routes, which reach the area switch only through this module.
 */
export { errorCodeOf }
