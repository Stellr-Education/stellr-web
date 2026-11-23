import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { getEventBySlug } from '@/lib/events/repo'
import { issueCredential, eventTenantOnce, recordSkip, type CredentialRow, type CredentialSkip } from '@/lib/credentials'
import { sendCredentialIssuedEmail } from '@/lib/credentials-notify'
import { themeFromType } from '@/lib/campaigns'
import { EVENT_AWARDS, mentorCredentialTitle } from '@/lib/event-awards'
import { listEventMentors } from '@/lib/event-certificates'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { stellrOnlyDb, type StellrOnlyDb } from '@/lib/events/admin-records'
import {
  activeRegistrationIds,
  checkedInCount,
  credentialCandidates,
  credentialsOnTenantPath,
  errorCodeOf,
  listEventCredentials,
  loadTenantCredentialPanel,
  loadCredentialSettings,
  saveCredentialSettings,
  type CredentialAudience,
  type CredentialSettings,
} from '@/lib/events/admin-credentials'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'

export const dynamic = 'force-dynamic'

// Platform audit (docs/TENANCY-S5.md, C7). The handler notes who passed requireEventRoute and
// the tenant that check placed the event in, so the event goes on that tenant's chain, never
// one picked from the raw slug in the URL.
//
// S5 wave 8, C19a: tenant_crew, and Stellr-only for other tenants. A credential says Stellr
// Education issued it, and none is issued for another tenant's event until the tenant is the
// issuer (decision W7-9; SQ-16's default: credentials are a tenant feature later). So every
// handler asks stellrOnlyEvent right after the access check: a tenant's staff get its 503,
// another tenant's event is a 404 for everyone, a Stellr admin included, and a failed read of
// the event's owner is a retryable 503. Stellr's own events answer as before.
//
// S5 A10c ('credentials' area, lib/events/admin-credentials.ts): the GET's list of issued
// credentials goes through the area switch, with Stellr's tenant from requireEventRoute. With
// TENANT_DB_AREAS unset it is today's query and opens no connection. One exception to the
// Stellr-only option, on GET alone: while the area is on the tenant path, another tenant's
// staff get their own event's panel, every part read through tenantDb pinned to their tenant
// (credentialsOnTenantPath, then loadTenantCredentialPanel). PATCH and POST stay Stellr-only
// on every path: issuing is W7-9's, and issueCredential refuses another tenant's event anyway.

const ROUTE = '/api/admin/events/[slug]/credentials'

// The audience and mode (enums) and the run's counts are the metadata: never a name,
// and never the wording, which is free text.
type Ctx = { params: Promise<{ slug: string }> }
const configureAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.credentials.configure' as const, ...auditSubject(req, 'event_settings') })
const issueAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.credentials.issue' as const, ...auditSubject(req, 'credentials') })

export const PATCH = withAudit(configureAudit, configureCredentials)
export const POST = withAudit(issueAudit, issueCredentials)

// Participation credentials for an event — the verifiable, per-person record
// beside the print certificates in ../certificates. Design: PLAN §3.3.
//
// Two audiences, chosen by `audience` (query string on GET, body otherwise):
//   students (default) — participation credentials for registered participants
//   mentors            — the Certificate of Appreciation credential for every
//                        volunteer mentor assigned on the Volunteers panel
// Each audience has its own wording in event_settings and its own list; the
// credential itself (page, wallet, consent, email, LinkedIn) is the same.
// Design: docs/PLAN-mentor-credentials-2026-10-08.md.

type Audience = CredentialAudience
const audienceOf = (v: unknown): Audience => (v === 'mentors' ? 'mentors' : 'students')

const ROLE_LABELS: Record<string, string> = {
  participant: 'Student',
  school_student_manager: 'Student Manager',
  teacher: 'Teacher',
  mentor: 'Mentor',
  volunteer: 'Volunteer',
  parent: 'Parent',
}

type Settings = CredentialSettings

// GET ?audience= — that audience's credential config and everything issued
// to it so far. Students see every event credential but the mentors'.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const audience = audienceOf(new URL(req.url).searchParams.get('audience'))
  // S5 A10c: another tenant's staff get their own event's panel, read through tenantDb pinned
  // to their tenant, only while the 'credentials' area is on the tenant path. Otherwise, and
  // always for Stellr's own staff, the Stellr-only option answers as before.
  if (credentialsOnTenantPath(crew.scope)) return tenantPanel(crew.tenantId, slug, audience)
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const db = stellrOnlyDb(crew.scope, supabaseServer())
  const regIds = await activeRegistrationIds(db, slug)
  const [settings, rows, checkedIn, mentors] = await Promise.all([
    loadCredentialSettings(db, slug, audience),
    // The 'credentials' area (S5 A10c): today's query unless TENANT_DB_AREAS moves it.
    listEventCredentials(db, crew.tenantId, slug, audience),
    checkedInCount(db, regIds),
    listEventMentors(db, slug),
  ])
  return NextResponse.json({
    audience,
    settings: settings ?? EMPTY_SETTINGS,
    credentials: rows,
    checkedInCount: checkedIn ?? 0,
    mentorCount: mentors.length,
  })
}

const EMPTY_SETTINGS: Settings = { credential_title: null, credential_description: null, credential_criteria: null, credential_skills: [] }

/**
 * The GET for another tenant's staff on the tenant path: the same shape, every part read
 * through tenantDb. mentorCount is 0: mentor containers are Stellr's alone (a CHECK on
 * mentoring_cohorts), and their names live in members, which tenant_app cannot read.
 * Issuing and the wording (POST, PATCH) stay Stellr-only.
 */
async function tenantPanel(tenantId: string, slug: string, audience: Audience) {
  try {
    const panel = await loadTenantCredentialPanel(tenantId, slug, audience)
    return NextResponse.json({
      audience,
      settings: panel.settings ?? EMPTY_SETTINGS,
      credentials: panel.credentials,
      checkedInCount: panel.checkedInCount,
      mentorCount: 0,
    })
  } catch (err) {
    console.error(`[${ROUTE}] tenant panel read failed:`, errorCodeOf(err))
    return NextResponse.json({ error: 'Could not load credentials' }, { status: 500 })
  }
}

// PATCH — credential config (title, description, criteria, skills) for `audience`.
async function configureCredentials(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = (await req.json().catch(() => ({}))) as Partial<Record<keyof Settings | 'audience', unknown>>
  const audience = audienceOf(body.audience)
  noteAuditSubject(req, { detail: { audience } })
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const { error } = await saveCredentialSettings(stellrOnlyDb(crew.scope, supabaseServer()), slug, audience, {
    credential_title:       clean(body.credential_title),
    credential_description: clean(body.credential_description),
    credential_criteria:    clean(body.credential_criteria),
    credential_skills:      Array.isArray(body.credential_skills)
      ? body.credential_skills.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
      : [],
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST — issue for everyone who took part.
// Body: { audience?: 'students' | 'mentors', mode?: 'checked_in' | 'all' }.
// Students — D2 (21 Sept 2026): checked-in when the event used check-in,
// otherwise all; the panel defaults the mode from checkedInCount and the admin
// can override. Mentors are not checked in at the door, so every assigned
// mentor is issued and `mode` is ignored; Revoke covers a no-show.
// Idempotent: anyone already holding one is skipped, not duplicated.
// A person issueCredential refuses (another tenant's event, or a consent form not yet
// signed: S5 A10a) is counted in `skipped` with the reason in `skips`, not as a
// failure (owner-approved follow-up, 13 Nov 2026). `failures` is for what went wrong.
async function issueCredentials(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = (await req.json().catch(() => ({}))) as { mode?: string; audience?: string }
  const audience = audienceOf(body.audience)
  const mode = body.mode === 'all' ? 'all' : 'checked_in'
  noteAuditSubject(req, { detail: { audience, mode: audience === 'mentors' ? 'all' : mode } })

  const db = stellrOnlyDb(crew.scope, supabaseServer())
  const [event, settings] = await Promise.all([getEventBySlug(slug).catch(() => null), loadCredentialSettings(db, slug, audience)])
  const eventTitle = (event as { title?: string } | null)?.title ?? slug
  // Sanity's `type` carries the competition theme; the badge ring follows it.
  const theme = themeFromType((event as { type?: string } | null)?.type) === 'enviro' ? 'environmental' : 'space'

  if (audience === 'mentors') {
    const run = await issueToMentors(db, slug, eventTitle, theme, settings)
    noteAuditSubject(req, { detail: runDetail(audience, run) })
    return NextResponse.json(run)
  }
  const title = settings?.credential_title ?? `${eventTitle} — Participant`

  const people = (await credentialCandidates(db, slug)).filter((p) => mode === 'all' || p.checked_in_at)

  let created = 0
  let existing = 0
  let emailed = 0
  const failures: string[] = []
  const skips: CredentialSkip[] = []
  // The event's owner, read once for the run (S5 A10a).
  const eventTenant = eventTenantOnce(db, slug)
  for (const p of people) {
    try {
      const result = await issueCredential(db, {
        source: 'event',
        awardType: 'participation',
        participantId: p.id,
        memberId: p.member_id,
        eventSlug: slug,
        recipient: { firstName: p.first_name, lastName: p.last_name, dateOfBirth: p.date_of_birth },
        title,
        description: settings?.credential_description ?? null,
        criteria:    settings?.credential_criteria ?? null,
        skills:      settings?.credential_skills ?? [],
        issuer:      'Stellr Education',
        roleLabel:   ROLE_LABELS[p.event_role] ?? 'Participant',
        award:       p.award,
        theme,
        eventTenant,
      })
      if (result.created) {
        created++
        const sent = await sendCredentialIssuedEmail(db, result.row, {
          firstName: p.first_name,
          email: p.email,
          guardianFirstName: p.emergency_contact_first_name,
          guardianEmail: p.emergency_contact_email,
        })
        if (sent) emailed++
      } else {
        existing++
      }
    } catch (err) {
      const name = `${p.first_name} ${p.last_name}`
      if (!recordSkip(err, name, skips)) failures.push(`${name}: ${(err as Error).message}`)
    }
  }

  noteAuditSubject(req, { detail: runDetail(audience, { mode, considered: people.length, created, existing, emailed, skipped: skips.length, failures }) })
  return NextResponse.json({ ok: true, mode, considered: people.length, created, existing, emailed, skipped: skips.length, skips, failures })
}

/**
 * A run's counts, for the audit event: the names in skips and failures stay out. The
 * emailed count is recorded as `notified`: the audit sanitiser drops any key containing
 * 'email' (lib/audit/platform.ts). The response keeps `emailed`.
 */
function runDetail(
  audience: Audience,
  run: { mode: string; considered: number; created: number; existing: number; emailed: number; skipped: number; failures: string[] },
) {
  return { audience, mode: run.mode, considered: run.considered, created: run.created, existing: run.existing, notified: run.emailed, skipped: run.skipped, failed: run.failures.length }
}

async function issueToMentors(
  db: StellrOnlyDb,
  slug: string,
  eventTitle: string,
  theme: 'space' | 'environmental',
  settings: Settings | null,
) {
  const def = EVENT_AWARDS.mentor
  const mentors = await listEventMentors(db, slug)
  let created = 0
  let existing = 0
  let emailed = 0
  const failures: string[] = []
  const skips: CredentialSkip[] = []
  const eventTenant = eventTenantOnce(db, slug)
  for (const m of mentors) {
    try {
      const result = await issueCredential(db, {
        source: 'event',
        awardType: 'mentor',
        memberId: m.member_id,
        eventSlug: slug,
        recipient: { firstName: m.first_name, lastName: m.last_name, dateOfBirth: m.date_of_birth },
        title:       settings?.credential_title ?? mentorCredentialTitle(eventTitle),
        description: settings?.credential_description ?? def.description,
        criteria:    settings?.credential_criteria ?? def.criteria,
        skills:      settings?.credential_skills ?? [],
        issuer:      'Stellr Education',
        roleLabel:   ROLE_LABELS.mentor,
        theme,
        eventTenant,
      })
      if (result.created) {
        created++
        if (await sendCredentialIssuedEmail(db, result.row, { firstName: m.first_name, email: m.email })) emailed++
      } else {
        existing++
      }
    } catch (err) {
      const name = `${m.first_name} ${m.last_name}`
      if (!recordSkip(err, name, skips)) failures.push(`${name}: ${(err as Error).message}`)
    }
  }
  return { ok: true, audience: 'mentors' as const, mode: 'all' as const, considered: mentors.length, created, existing, emailed, skipped: skips.length, skips, failures }
}

export type EventCredentialRow = CredentialRow
