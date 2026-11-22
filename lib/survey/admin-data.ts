// Event survey admin data: the 'surveys' area (multi-tenancy plan S5, A10c).
//
// The data behind an event's "Survey" tab (app/api/admin/events/[slug]/survey): the event's
// distribution, its completion table (invitations with their response progress), the
// access-log row for viewing that table, and the admin writes on the distribution row
// (pause, resume, close, go-live, audiences, the certificate gate). Each keeps today's
// supabase-js query as its service path, unchanged, beside a tenantDb path written to
// return the same rows:
//
//   service  (the default: TENANT_DB_AREAS unset, or TENANT_DB_ENABLED not 'true')
//            today's query, exactly as before. tenantDb is not built, so nothing loads
//            the Postgres client and no connection opens
//   shadow   today's query answers; a sampled share of the reads also runs the tenantDb
//            read after the response, read-only, and records a difference by uuid and
//            count only, never a row's content. Writes take the service path alone
//   tenant   the tenantDb read or write answers, pinned to the caller's tenant, under the
//            tenant row level security policies: another tenant's event reads as empty,
//            and a write naming its distribution changes nothing
//
// The tenant comes from the caller's own scope (requireEventRoute's tenantId), never from
// request input. The route has placed the event in that scope first.
//
// What the tenant path cannot reproduce, because tenant_app has no grant on it:
//   - members (S7): the completion table's `members` embed (the name of an invitation with
//     no participant) is null on the tenant path, so that row's name falls back to the
//     invitation's first name, then its email. The shadow comparison drops `members`.
//   - survey_definitions (platform content): the distribution read cannot join the
//     definition to filter on its key, so it takes the event's newest distribution. Every
//     distribution is a post_event one today (lib/survey/definitions holds no other key).
//
// Out of scope, on the service path in every mode: the respondent-facing token pages, the
// survey cron and every send (send_now, resend, open_after_event), the recipient plan (it
// reads members), ensureDistribution (Sanity and the definition), audit_log rows, and the
// Stellr-only cross-event pages (analytics, export, testimonials).
import type { SupabaseClient } from '@supabase/supabase-js'
import { dataPath, errorCodeOf, readArea, writeArea } from '@/lib/tenancy/area-switch'
import type { TenantDb } from '@/lib/tenancy/db'
import { logSurveyAccess } from './audit'
import { distributionForEvent, serviceDistributionUpdate, type DistributionRow, type DistributionUpdate, type SurveyAdminDb } from './distributions'

/** The area name in TENANT_DB_AREAS. */
export const SURVEYS_AREA = 'surveys' as const

const LABEL = 'GET /api/admin/events/[slug]/survey'

/**
 * True when the 'surveys' area answers through tenantDb. The survey tab serves another
 * tenant's staff only then: every read it makes for them is one of this module's.
 */
export function surveysOnTenantPath(): boolean {
  return dataPath(SURVEYS_AREA) === 'tenant'
}

/** A jsonb column, whether the driver parsed it or handed back its text. */
function parsed<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

// ── The distribution ────────────────────────────────────────────────────────

/**
 * The tenantDb read: the event's newest distribution, as PostgREST renders the row (to_jsonb,
 * so dates and timestamps read as text as on the service path). No definition-key filter:
 * see the file header.
 */
export async function tenantDistributionForEvent(db: TenantDb, slug: string): Promise<DistributionRow | null> {
  const rows = await db.sql<{ row: unknown }>`
    SELECT to_jsonb(d) AS row
    FROM public.survey_distributions d
    WHERE d.event_slug = ${slug}
    ORDER BY d.created_at DESC
    LIMIT 1`
  return rows.length ? parsed<DistributionRow>(rows[0].row) : null
}

/** The event's distribution. Service: distributionForEvent, unchanged, and its throw. */
export function loadDistributionForEvent(svc: SupabaseClient, tenantId: string, slug: string): Promise<DistributionRow | null> {
  return readArea<DistributionRow | null, DistributionRow>(SURVEYS_AREA, {
    tenantId,
    label: LABEL,
    service: () => distributionForEvent(svc, slug),
    tenant: (tdb) => tenantDistributionForEvent(tdb, slug),
  })
}

// ── The completion table ────────────────────────────────────────────────────

/** One invitation as the completion table reads it: supabase-js's embedded shape. */
export interface CompletionInvitation {
  id: string
  member_id: string | null
  first_name: string | null
  respondent_role: 'student' | 'mentor' | 'adult'
  adult_relationship: string | null
  email: string
  send_via: 'self' | 'guardian'
  status: string
  sent_at: string | null
  first_opened_at: string | null
  opened_from: string | null
  last_activity_at: string | null
  reminder_count: number
  resume_reminder_count: number
  reminders_opted_out_at: string | null
  last_send_error: string | null
  participants: { first_name: string | null; last_name: string | null; member_id?: string | null } | null
  /** Always null on the tenant path (no members grant, S7). */
  members: { first_name: string | null; last_name: string | null } | null
  survey_responses: { started_at: string | null; submitted_at: string | null } | { started_at: string | null; submitted_at: string | null }[] | null
}

/** Today's select, unchanged. */
export const COMPLETION_SELECT =
  'id, member_id, first_name, respondent_role, adult_relationship, email, send_via, status, sent_at, first_opened_at, opened_from, last_activity_at, reminder_count, resume_reminder_count, reminders_opted_out_at, last_send_error, participants(first_name, last_name, member_id), members(first_name, last_name), survey_responses(started_at, submitted_at)'

/**
 * The tenantDb read: a distribution's invitations, built as JSON so every value reads as
 * PostgREST renders it. survey_responses.invitation_id is unique, so the embed is one object
 * or null, as on the service path. No members join (see the file header).
 */
export async function tenantCompletionInvitations(db: TenantDb, distributionId: string): Promise<CompletionInvitation[]> {
  const rows = await db.sql<{ row: unknown }>`
    SELECT jsonb_build_object(
      'id', i.id, 'member_id', i.member_id, 'first_name', i.first_name,
      'respondent_role', i.respondent_role, 'adult_relationship', i.adult_relationship,
      'email', i.email, 'send_via', i.send_via, 'status', i.status, 'sent_at', i.sent_at,
      'first_opened_at', i.first_opened_at, 'opened_from', i.opened_from,
      'last_activity_at', i.last_activity_at, 'reminder_count', i.reminder_count,
      'resume_reminder_count', i.resume_reminder_count,
      'reminders_opted_out_at', i.reminders_opted_out_at, 'last_send_error', i.last_send_error,
      'participants', (SELECT jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'member_id', p.member_id)
                         FROM public.participants p WHERE p.id = i.participant_id),
      'members', NULL::jsonb,
      'survey_responses', (SELECT jsonb_build_object('started_at', r.started_at, 'submitted_at', r.submitted_at)
                             FROM public.survey_responses r WHERE r.invitation_id = i.id)
    ) AS row
    FROM public.survey_invitations i
    WHERE i.distribution_id = ${distributionId}::uuid`
  return rows.map((r) => parsed<CompletionInvitation>(r.row))
}

/** The shadow comparison leaves out what the tenant path cannot read. */
export function withoutMembers(row: CompletionInvitation): Omit<CompletionInvitation, 'members'> {
  const { members: _members, ...rest } = row
  return rest
}

/** A distribution's invitations for the completion table. Service: today's query; its error throws today's Error. */
export function loadCompletionInvitations(svc: SupabaseClient, tenantId: string, distributionId: string): Promise<CompletionInvitation[]> {
  return readArea<CompletionInvitation[], CompletionInvitation>(SURVEYS_AREA, {
    tenantId,
    label: LABEL,
    normalise: withoutMembers,
    service: async () => {
      const { data: invs, error } = await svc.from('survey_invitations').select(COMPLETION_SELECT).eq('distribution_id', distributionId)
      if (error) throw new Error(`Reading invitations failed: ${error.message}`)
      return (invs ?? []) as unknown as CompletionInvitation[]
    },
    tenant: (tdb) => tenantCompletionInvitations(tdb, distributionId),
  })
}

// ── Viewing the table: survey_access_log ────────────────────────────────────

export interface SurveyViewEntry {
  actor: string
  eventSlug: string
  distributionId: string | null
  rowCount: number
}

/** The tenantDb write of the access-log row, stamped with the pinned tenant. */
export async function tenantLogSurveyView(db: TenantDb, entry: SurveyViewEntry): Promise<void> {
  await db.sql`
    INSERT INTO public.survey_access_log (tenant_id, actor, action, event_slug, distribution_id, row_count, detail)
    VALUES (${db.tenantId}::uuid, ${entry.actor}, 'view', ${entry.eventSlug}, ${entry.distributionId}::uuid, ${entry.rowCount}::int,
            ${JSON.stringify({ what: 'completion_table' })}::jsonb)`
}

/** Record a view of the completion table. Never throws, as today: a failed write is logged. */
export function logSurveyView(svc: SupabaseClient, tenantId: string, entry: SurveyViewEntry): Promise<void> {
  return writeArea(SURVEYS_AREA, {
    tenantId,
    service: () =>
      logSurveyAccess(svc, {
        actor: entry.actor,
        tenantId,
        action: 'view',
        eventSlug: entry.eventSlug,
        distributionId: entry.distributionId,
        rowCount: entry.rowCount,
        detail: { what: 'completion_table' },
      }),
    tenant: (tdb) =>
      tenantLogSurveyView(tdb, entry).catch((err) => {
        console.error('[survey] survey_access_log write failed:', errorCodeOf(err))
      }),
  })
}

// ── The distribution row's admin writes ─────────────────────────────────────

/** The columns an admin action may set (lib/survey/distributions.ts). Any other key is refused. */
export const PATCHABLE_COLUMNS = [
  'opens_at',
  'opens_at_source',
  'opened_by',
  'opened_by_label',
  'opens_at_set_at',
  'schedule_flag',
  'status',
  'opened_at',
  'paused_at',
  'closed_at',
  'closed_by',
  'audiences',
  'minor_agreement_override',
  'minor_agreement_override_set_by',
  'minor_agreement_override_set_at',
  'gate_certificate',
] as const

/**
 * The tenantDb write: the patch's columns (and only those) on this distribution, if its
 * status is one of `onlyIfStatus`. Values are bound as one jsonb and typed by the table's own
 * row type. Under the tenant policies another tenant's row is invisible, so it matches
 * nothing. Returns the changed rows as PostgREST renders them.
 */
export async function tenantUpdateDistribution(
  db: TenantDb,
  id: string,
  patch: Record<string, unknown>,
  onlyIfStatus?: readonly string[],
): Promise<DistributionRow[]> {
  const keys = Object.keys(patch)
  const unknown = keys.filter((k) => !(PATCHABLE_COLUMNS as readonly string[]).includes(k))
  if (unknown.length || !keys.length) throw new Error('survey distribution patch: unsupported columns')
  const j = JSON.stringify(patch)
  const statuses = onlyIfStatus?.length ? onlyIfStatus.join(',') : null
  const rows = await db.sql<{ row: unknown }>`
    UPDATE public.survey_distributions d SET
      opens_at = CASE WHEN ${j}::jsonb ? 'opens_at' THEN r.opens_at ELSE d.opens_at END,
      opens_at_source = CASE WHEN ${j}::jsonb ? 'opens_at_source' THEN r.opens_at_source ELSE d.opens_at_source END,
      opened_by = CASE WHEN ${j}::jsonb ? 'opened_by' THEN r.opened_by ELSE d.opened_by END,
      opened_by_label = CASE WHEN ${j}::jsonb ? 'opened_by_label' THEN r.opened_by_label ELSE d.opened_by_label END,
      opens_at_set_at = CASE WHEN ${j}::jsonb ? 'opens_at_set_at' THEN r.opens_at_set_at ELSE d.opens_at_set_at END,
      schedule_flag = CASE WHEN ${j}::jsonb ? 'schedule_flag' THEN r.schedule_flag ELSE d.schedule_flag END,
      status = CASE WHEN ${j}::jsonb ? 'status' THEN r.status ELSE d.status END,
      opened_at = CASE WHEN ${j}::jsonb ? 'opened_at' THEN r.opened_at ELSE d.opened_at END,
      paused_at = CASE WHEN ${j}::jsonb ? 'paused_at' THEN r.paused_at ELSE d.paused_at END,
      closed_at = CASE WHEN ${j}::jsonb ? 'closed_at' THEN r.closed_at ELSE d.closed_at END,
      closed_by = CASE WHEN ${j}::jsonb ? 'closed_by' THEN r.closed_by ELSE d.closed_by END,
      audiences = CASE WHEN ${j}::jsonb ? 'audiences' THEN r.audiences ELSE d.audiences END,
      minor_agreement_override = CASE WHEN ${j}::jsonb ? 'minor_agreement_override' THEN r.minor_agreement_override ELSE d.minor_agreement_override END,
      minor_agreement_override_set_by = CASE WHEN ${j}::jsonb ? 'minor_agreement_override_set_by' THEN r.minor_agreement_override_set_by ELSE d.minor_agreement_override_set_by END,
      minor_agreement_override_set_at = CASE WHEN ${j}::jsonb ? 'minor_agreement_override_set_at' THEN r.minor_agreement_override_set_at ELSE d.minor_agreement_override_set_at END,
      gate_certificate = CASE WHEN ${j}::jsonb ? 'gate_certificate' THEN r.gate_certificate ELSE d.gate_certificate END
    FROM jsonb_populate_record(NULL::public.survey_distributions, ${j}::jsonb) r
    WHERE d.id = ${id}::uuid
      AND (${statuses}::text IS NULL OR d.status = ANY (string_to_array(${statuses}::text, ',')))
    RETURNING to_jsonb(d) AS row`
  return rows.map((r) => parsed<DistributionRow>(r.row))
}

/**
 * Where the survey tab's admin actions write the distribution row: through the 'surveys'
 * area. Service: today's update (serviceDistributionUpdate). Tenant: tenantUpdateDistribution,
 * and a refusal answers a fixed message, never the database's. `db` takes the audit_log row.
 */
export function surveyAdminDb(svc: SupabaseClient, tenantId: string): SurveyAdminDb {
  const service = serviceDistributionUpdate(svc)
  const updateDistribution: DistributionUpdate = (id, patch, onlyIfStatus) =>
    writeArea(SURVEYS_AREA, {
      tenantId,
      service: () => service(id, patch, onlyIfStatus),
      tenant: async (tdb) => {
        try {
          return { data: await tenantUpdateDistribution(tdb, id, patch, onlyIfStatus), error: null }
        } catch (err) {
          console.error('[survey] distribution write refused:', errorCodeOf(err))
          return { data: null, error: { message: 'The survey could not be saved. Try again.' } }
        }
      },
    })
  return { db: svc, updateDistribution }
}

/**
 * gate_certificate on the event's distribution. Service: the route's own scoped write, as
 * today, whose result the route does not read. Tenant: the same column through
 * tenantUpdateDistribution, a refusal logged by its code and otherwise ignored, as today.
 */
export function setDistributionGateCertificate(
  service: () => PromiseLike<unknown>,
  tenantId: string,
  distributionId: string,
  on: boolean,
): Promise<void> {
  return writeArea(SURVEYS_AREA, {
    tenantId,
    service: async () => {
      await service()
    },
    tenant: async (tdb) => {
      await tenantUpdateDistribution(tdb, distributionId, { gate_certificate: on }).catch((err) => {
        console.error('[survey] certificate gate write refused:', errorCodeOf(err))
      })
    },
  })
}
