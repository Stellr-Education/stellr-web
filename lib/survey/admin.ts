/**
 * What the admin "Survey" tab shows for one event (handover A1/A2): the
 * schedule, who will be (or was) invited, who can't be, and per-person
 * progress. Admins and the event's assigned managers see it.
 *
 * The distribution and the completion table read through the 'surveys' area
 * (lib/survey/admin-data.ts, S5 A10c). Another tenant's staff, who reach the tab only
 * when that area is on the tenant path, get those two and nothing read through the
 * service client: no schedule sync, no recipient preview (it reads members), no
 * definition and no late-open preview.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureDistribution, planFor, statusNow, type DistributionRow } from './distributions'
import { loadCompletionInvitations, loadDistributionForEvent, type CompletionInvitation } from './admin-data'
import { loadSurveyEvent } from './events'
import { autoOpensAt, closesAtFor, lateOpenDeadline } from './schedule'
import { buildRecipientPlan, type RecipientPlan } from './recipients'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { HELD_FOR_TENANT_SURVEY } from './hold'

export interface CompletionRow {
  invitationId: string
  name: string
  /** The member behind the invitation (directly, or through the participant), for the admin link. */
  memberId: string | null
  role: 'student' | 'mentor' | 'adult'
  relationship: string | null
  email: string
  sendVia: 'self' | 'guardian'
  status: string
  sentAt: string | null
  openedAt: string | null
  openedFrom: string | null
  startedAt: string | null
  submittedAt: string | null
  lastActivityAt: string | null
  reminders: number
  remindersOff: boolean
  lastError: string | null
  /** Held, not failed: another tenant's survey sends nothing yet (W7-16). `lastError` holds the label. */
  held: boolean
}

export interface AdminSurveyView {
  distribution: DistributionRow | null
  status: DistributionRow['status'] | null
  autoOpensAt: string | null
  /** Why there is no distribution, when there isn't one. */
  reason: string | null
  definition: { key: string; version: number; versionLabel: string | null; status: string } | null
  preview: {
    byRole: Record<'student' | 'mentor' | 'adult', number>
    invitable: number
    unreachable: RecipientPlan['unreachable']
    awaitingConsent: RecipientPlan['awaitingConsent']
    olderAgreementAccepted: number
    headcountOnlyAdults: number
  } | null
  /**
   * An event that ended without a survey, still inside its 30-day window: an
   * admin may open one now. Counts assume every audience; `olderAgreements`
   * is how many more minors the pre-V2.3 override would add.
   */
  lateOpen: {
    lastDay: string
    timeZone: string
    deadline: string
    closesIfOpenedNow: string
    invitable: number
    byRole: Record<'student' | 'mentor' | 'adult', number>
    olderAgreements: number
    awaitingConsent: number
  } | null
  totals: { invited: number; sent: number; opened: number; started: number; submitted: number; queued: number; optedOut: number }
  rows: CompletionRow[]
}

/**
 * `eventTenant` is the event's owner, for the late-open preview: with no distribution yet
 * there is no row to read it from, and another tenant's preview leaves out its
 * consent-pending students as the plan made on opening would (S5 A10b). It is asked only
 * for that preview. Left out, the event is Stellr's and nothing is read.
 *
 * `scope` is whose staff is asking (the route's crew): its tenant reads the 'surveys' area,
 * and `stellr: false` gives the narrowed view in the file header. Left out, Stellr's staff.
 */
export async function adminSurveyView(
  db: SupabaseClient,
  slug: string,
  now = new Date(),
  eventTenant: () => Promise<string> = async () => STELLR_TENANT_ID,
  scope: SurveyViewScope = { tenantId: STELLR_TENANT_ID, stellr: true },
): Promise<AdminSurveyView> {
  let d = await loadDistributionForEvent(db, scope.tenantId, slug)
  if (!scope.stellr) return tenantStaffView(db, scope.tenantId, d, now)
  let reason: string | null = null
  // Keep it in step with Sanity (date moved, cancelled) — or create it, for an
  // event that predates the survey feature.
  const event = await loadSurveyEvent(slug).catch(() => null)
  if (event) {
    const r = await ensureDistribution(db, event, now)
    if (r.action === 'skipped') reason = r.reason
    else d = r.distribution
  }

  const empty = { invited: 0, sent: 0, opened: 0, started: 0, submitted: 0, queued: 0, optedOut: 0 }
  if (!d) {
    let lateOpen: AdminSurveyView['lateOpen'] = null
    const deadline = event?.lastDay && !event.cancelled && reason === 'past event' ? lateOpenDeadline(event.lastDay, event.timeZone, now) : null
    if (event?.lastDay && deadline) {
      const plan = await buildRecipientPlan(db, slug, event.lastDay, ['student', 'mentor', 'adult'], { acceptOlderMinorAgreements: true }, await eventTenant())
      const byRole = { student: 0, mentor: 0, adult: 0 }
      for (const p of plan.invitable) byRole[p.role]++
      lateOpen = {
        lastDay: event.lastDay,
        timeZone: event.timeZone,
        deadline: deadline.toISOString(),
        closesIfOpenedNow: closesAtFor(now).toISOString(),
        invitable: plan.invitable.length,
        byRole,
        olderAgreements: plan.olderAgreementAccepted,
        awaitingConsent: plan.awaitingConsent.length,
      }
    }
    return { distribution: null, status: null, autoOpensAt: null, reason: reason ?? 'not scheduled', definition: null, preview: null, lateOpen, totals: empty, rows: [] }
  }

  const { data: defRow } = await db.from('survey_definitions').select('key, version, status, version_label:definition->>version_label').eq('id', d.definition_id).maybeSingle()
  const status = statusNow(d, now)

  const plan = await planFor(db, d)
  const byRole = { student: 0, mentor: 0, adult: 0 }
  for (const p of plan.invitable) byRole[p.role]++
  const preview = {
    byRole,
    invitable: plan.invitable.length,
    unreachable: plan.unreachable,
    awaitingConsent: plan.awaitingConsent,
    olderAgreementAccepted: plan.olderAgreementAccepted,
    headcountOnlyAdults: plan.headcountOnlyAdults,
  }

  const { rows, totals } = completion(await loadCompletionInvitations(db, scope.tenantId, d.id))

  return {
    distribution: d,
    status,
    autoOpensAt: autoOpensAt(d.event_date, d.event_time_zone).toISOString(),
    reason: null,
    definition: defRow ? { key: defRow.key as string, version: defRow.version as number, versionLabel: (defRow.version_label as string | null) ?? null, status: defRow.status as string } : null,
    preview,
    lateOpen: null,
    totals,
    rows,
  }
}

/** Whose staff the view is for: see adminSurveyView. */
export interface SurveyViewScope {
  tenantId: string
  stellr: boolean
}

const EMPTY_TOTALS: AdminSurveyView['totals'] = { invited: 0, sent: 0, opened: 0, started: 0, submitted: 0, queued: 0, optedOut: 0 }

/** The completion table and its totals, from the invitations as read. */
function completion(invs: CompletionInvitation[]): { rows: CompletionRow[]; totals: AdminSurveyView['totals'] } {
  const rows: CompletionRow[] = invs.map((i) => {
    const resp = Array.isArray(i.survey_responses) ? i.survey_responses[0] : i.survey_responses
    const person = i.participants ?? i.members
    const name = [person?.first_name ?? i.first_name, person?.last_name].filter(Boolean).join(' ') || i.email
    return {
      invitationId: i.id,
      name,
      memberId: i.member_id ?? i.participants?.member_id ?? null,
      role: i.respondent_role,
      relationship: i.adult_relationship,
      email: i.email,
      sendVia: i.send_via,
      status: i.status,
      sentAt: i.sent_at,
      openedAt: i.first_opened_at,
      openedFrom: i.opened_from,
      startedAt: resp?.started_at ?? null,
      submittedAt: resp?.submitted_at ?? null,
      lastActivityAt: i.last_activity_at,
      reminders: i.reminder_count + i.resume_reminder_count,
      remindersOff: !!i.reminders_opted_out_at,
      lastError: i.last_send_error,
      // Only a queued row is still held: one expired later keeps the label but never goes out.
      held: i.status === 'queued' && i.last_send_error === HELD_FOR_TENANT_SURVEY,
    }
  })
  rows.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))

  const totals = { ...EMPTY_TOTALS, invited: rows.length }
  for (const r of rows) {
    if (r.sentAt) totals.sent++
    if (r.openedAt) totals.opened++
    if (r.startedAt) totals.started++
    if (r.submittedAt) totals.submitted++
    if (r.status === 'queued') totals.queued++
    if (r.remindersOff) totals.optedOut++
  }
  return { rows, totals }
}

/** Another tenant's staff: the distribution and its completion table, both through the 'surveys' area. */
async function tenantStaffView(db: SupabaseClient, tenantId: string, d: DistributionRow | null, now: Date): Promise<AdminSurveyView> {
  if (!d) {
    return { distribution: null, status: null, autoOpensAt: null, reason: 'not scheduled', definition: null, preview: null, lateOpen: null, totals: EMPTY_TOTALS, rows: [] }
  }
  const { rows, totals } = completion(await loadCompletionInvitations(db, tenantId, d.id))
  return {
    distribution: d,
    status: statusNow(d, now),
    autoOpensAt: autoOpensAt(d.event_date, d.event_time_zone).toISOString(),
    reason: null,
    definition: null,
    preview: null,
    lateOpen: null,
    totals,
    rows,
  }
}

/** The close date a proposed go-live would give, for the confirm step. */
export function closePreview(opensAt: Date): string {
  return closesAtFor(opensAt).toISOString()
}
