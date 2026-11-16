// The queries behind app/api/admin/events/[slug]/credentials, moved here as they were when
// the route became tenant_crew (S5 wave 8, C19a): test/route-manifest.test.ts holds a
// tenant_crew file off a direct .from(). The route answers stellrOnlyEvent first, because a
// credential says Stellr Education issued it and none is issued for another tenant's event
// until the tenant is the issuer (decision W7-9; SQ-16's default: credentials are a tenant
// feature later). So every helper takes a StellrOnlyDb, which only stellrOnlyDb hands out, in
// Stellr's scope.
import type { StellrOnlyDb } from '@/lib/events/admin-records'

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
  const row = data as unknown as Record<string, unknown>
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
