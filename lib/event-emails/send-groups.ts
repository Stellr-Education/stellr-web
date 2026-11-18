// History groups an email's runs into ONE send. A big send can take several
// runs (each run stops at its time limit and the next carries on), and staff
// think of it as one blast: "has everyone had the consent email?". This turns
// the per-run rows into that one answer: a status, counts by outcome, and one
// line per person. Pure: safe to import from client components.

import { AUDIENCES, type EventEmailRow, type EventEmailSendRow, type RecipientRole } from './types'

/** The event-email cron's UTC hours (vercel.json; send-groups.test.ts keeps them in step). */
export const EVENT_EMAIL_CRON_UTC_HOURS = [15, 17, 19] as const

/** A run with no finish time this long after it started was cut off, not still going. */
export const CUT_OFF_AFTER_MS = 2 * 60_000

export type RecipientOutcome =
  | 'delivered'   // handed to Resend (or the outbox) and not since bounced
  | 'blocked'     // accepted, but the address has since bounced / complained
  | 'suppressed'  // not sent: the address was already on the suppression list
  | 'failed'      // Resend refused it
  | 'unconfirmed' // the run was killed while sending to them: may or may not have gone
  | 'sending'     // the run is sending to them right now
  | 'waiting'     // not reached yet; the next run picks them up
  | 'left_list'   // not reached, and no longer in the group by their turn

export const OUTCOME_LABEL: Record<RecipientOutcome, string> = {
  delivered: 'Delivered',
  blocked: 'Bounced',
  suppressed: 'Not sent (address blocked)',
  failed: 'Failed',
  unconfirmed: 'Unconfirmed',
  sending: 'Sending',
  waiting: 'Waiting',
  left_list: 'Left the group',
}

/** Outcomes that need someone to look at them. */
export const PROBLEM_OUTCOMES: RecipientOutcome[] = ['blocked', 'suppressed', 'failed', 'unconfirmed']

export interface GroupRecipient {
  email: string
  name: string
  memberId: string | null
  roles: RecipientRole[]
  outcome: RecipientOutcome
  /** Messages handed to Resend for this address in this send (more than 1 = emailed twice). */
  times: number
  /** When this address's last attempt ran (its run's start). */
  at: string
  error?: string
  blockedReason?: string
}

export type SendStatus =
  | { kind: 'sending' }
  /** Stopped part-way. resumeNow: the email is waiting for "Resume now" (or the cron's stuck-send sweep). */
  | { kind: 'paused'; resumeNow: boolean; nextRunAt: string | null }
  | { kind: 'finished' }
  | { kind: 'finished_with_problems' }
  | { kind: 'stopped' }

export interface SendGroup {
  key: string
  emailId: string | null
  emailName: string
  subject: string
  audiences: EventEmailSendRow['audiences']
  trigger: EventEmailSendRow['trigger']
  triggeredBy: string | null
  startedAt: string
  lastRunAt: string
  /** Oldest first. */
  runs: EventEmailSendRow[]
  status: SendStatus
  /** Who the send set out to email: the first run's list. */
  planned: number
  recipients: GroupRecipient[]
  counts: Record<RecipientOutcome, number>
  /** Addresses emailed more than once in this send. */
  duplicates: number
  docusignResent: number
}

const SENT_LIKE = new Set(['sent', 'queued'])

/** The next event-email cron slot after `now` (ISO). */
export function nextCronRun(now: Date): string {
  for (let day = 0; day < 2; day++) {
    for (const h of EVENT_EMAIL_CRON_UTC_HOURS) {
      const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, h))
      if (t > now) return t.toISOString()
    }
  }
  return new Date(now.getTime() + 86_400_000).toISOString()
}

function groupKey(h: EventEmailSendRow): string {
  // One email = one send for its normal runs (Sent now, Scheduled, resumes).
  // A test, and each late-registrant catch-up, is a send of its own.
  if (h.event_email_id && (h.trigger === 'manual' || h.trigger === 'schedule')) return `email:${h.event_email_id}`
  return `run:${h.id}`
}

export function groupSends(history: EventEmailSendRow[], emails: Pick<EventEmailRow, 'id' | 'status' | 'updated_at'>[], now = new Date()): SendGroup[] {
  const byKey = new Map<string, EventEmailSendRow[]>()
  for (const h of history) {
    const k = groupKey(h)
    const list = byKey.get(k) ?? []
    list.push(h)
    byKey.set(k, list)
  }
  const emailById = new Map(emails.map((e) => [e.id, e]))

  const groups = [...byKey.entries()].map(([key, list]) => {
    const runs = [...list].sort((a, b) => a.started_at.localeCompare(b.started_at))
    const first = runs[0]
    const last = runs[runs.length - 1]
    const email = first.event_email_id ? emailById.get(first.event_email_id) : undefined
    const lastLive = last.finished_at == null && now.getTime() - new Date(last.started_at).getTime() <= CUT_OFF_AFTER_MS

    // One line per address, oldest run first.
    const people = new Map<string, GroupRecipient & { lastRun: number }>()
    runs.forEach((run, i) => {
      for (const r of run.recipients ?? []) {
        const k = r.email.toLowerCase()
        const seen = people.get(k)
        if (r.status === 'not_reached') {
          if (!seen) {
            people.set(k, { email: r.email, name: r.name, memberId: r.memberId ?? null, roles: r.roles, outcome: 'waiting', times: 0, at: run.started_at, lastRun: i })
          } else if (seen.outcome === 'waiting') {
            seen.lastRun = i
          }
          continue
        }
        const handed = r.status !== 'suppressed' && r.status !== 'failed' ? 1 : 0
        const outcome: RecipientOutcome =
          r.status === 'sending' ? (i === runs.length - 1 && lastLive ? 'sending' : 'unconfirmed')
            : r.status === 'failed' ? 'failed'
              : r.status === 'suppressed' ? 'suppressed'
                : r.blocked ? 'blocked'
                  : 'delivered'
        const next = {
          email: r.email, name: r.name, memberId: r.memberId ?? null, roles: r.roles, outcome,
          times: (seen?.times ?? 0) + handed, at: run.started_at, lastRun: i,
          ...(r.error ? { error: r.error } : {}),
          ...(r.blocked ? { blockedReason: r.blocked } : {}),
        }
        // A later 'delivered' beats an earlier problem; otherwise the latest attempt wins.
        if (!seen || seen.outcome === 'waiting' || outcome === 'delivered' || seen.outcome !== 'delivered') people.set(k, next)
        else seen.times = next.times
      }
    })

    const status = statusFor(runs, email, lastLive, now)
    const finished = status.kind === 'finished' || status.kind === 'finished_with_problems' || status.kind === 'stopped'
    for (const p of people.values()) {
      // Listed as not reached by an earlier run but not by the latest one, and
      // never emailed: they had left the group (e.g. signed) by their turn.
      if (p.outcome === 'waiting' && (finished || p.lastRun < runs.length - 1)) p.outcome = 'left_list'
    }

    const recipients = [...people.values()].map(({ lastRun: _l, ...p }) => p)
    const counts = Object.fromEntries((Object.keys(OUTCOME_LABEL) as RecipientOutcome[]).map((o) => [o, 0])) as Record<RecipientOutcome, number>
    for (const p of recipients) counts[p.outcome]++

    // Runs recorded before 18 Nov 2026 do not list who they did not reach, so
    // anyone who dropped out between runs is only visible as a count.
    const planned = first.recipient_count
    const accounted = recipients.length
    if (finished && planned > accounted) counts.left_list += planned - accounted

    // Problems the email row alone can't show still make a finished send "with problems".
    const resolved: SendStatus = status.kind === 'finished' && PROBLEM_OUTCOMES.some((o) => counts[o] > 0)
      ? { kind: 'finished_with_problems' }
      : status

    return {
      key,
      emailId: first.event_email_id,
      emailName: last.email_name,
      subject: last.subject,
      audiences: last.audiences,
      trigger: first.trigger,
      triggeredBy: first.triggered_by,
      startedAt: first.started_at,
      lastRunAt: last.started_at,
      runs,
      status: resolved,
      planned,
      recipients: recipients.sort(byOutcomeThenName),
      counts,
      duplicates: recipients.filter((p) => p.times > 1).length,
      docusignResent: runs.reduce((n, r) => n + (r.docusign_resent ?? 0), 0),
    } satisfies SendGroup
  })

  return groups.sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt))
}

function statusFor(
  runs: EventEmailSendRow[],
  email: Pick<EventEmailRow, 'status' | 'updated_at'> | undefined,
  lastLive: boolean,
  now: Date,
): SendStatus {
  const last = runs[runs.length - 1]
  if (lastLive) return { kind: 'sending' }
  const owesSomeone = (last.recipients ?? []).some((r) => r.status === 'not_reached')
  // Tests, catch-ups and runs of a deleted email: only the runs can tell.
  if (!email || !(last.trigger === 'manual' || last.trigger === 'schedule')) {
    if (last.finished_at == null) return { kind: 'paused', resumeNow: false, nextRunAt: nextCronRun(now) }
    return owesSomeone ? { kind: 'paused', resumeNow: false, nextRunAt: nextCronRun(now) } : { kind: 'finished' }
  }
  switch (email.status) {
    case 'sending': {
      // A live run heartbeats updated_at; a silent one is waiting to be resumed.
      const silent = !email.updated_at || now.getTime() - new Date(email.updated_at).getTime() > CUT_OFF_AFTER_MS
      return silent || last.finished_at != null ? { kind: 'paused', resumeNow: true, nextRunAt: nextCronRun(now) } : { kind: 'sending' }
    }
    case 'draft':
    case 'scheduled':
      return { kind: 'paused', resumeNow: false, nextRunAt: nextCronRun(now) }
    case 'sent':
      return { kind: 'finished' }
    default:
      return { kind: 'stopped' }
  }
}

const OUTCOME_ORDER: RecipientOutcome[] = ['unconfirmed', 'failed', 'blocked', 'suppressed', 'sending', 'waiting', 'delivered', 'left_list']
function byOutcomeThenName(a: GroupRecipient, b: GroupRecipient): number {
  return OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome)
    || (b.times > 1 ? 1 : 0) - (a.times > 1 ? 1 : 0)
    || a.name.localeCompare(b.name)
}

const audienceLabel = (key: string) => AUDIENCES.find((a) => a.key === key)?.label ?? key

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per person, for "Download CSV". */
export function sendGroupCsv(g: SendGroup, roleLabel: (r: RecipientRole) => string): string {
  const head = ['Name', 'Email', 'Roles', 'Result', 'Times emailed', 'Run (UTC)', 'Detail']
  const rows = g.recipients.map((p) => [
    p.name === p.email ? '' : p.name,
    p.email,
    p.roles.map(roleLabel).join('; '),
    OUTCOME_LABEL[p.outcome],
    p.times,
    p.at,
    p.error ?? (p.blockedReason ? `address ${p.blockedReason}` : ''),
  ])
  return [
    [`${g.emailName} — ${g.audiences.map(audienceLabel).join(', ')}`],
    head,
    ...rows,
  ].map((r) => r.map(csvCell).join(',')).join('\n')
}
