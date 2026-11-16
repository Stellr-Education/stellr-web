import type { SupabaseClient } from '@supabase/supabase-js'
import { lastCronResult } from '@/lib/cron-runs'
import { notifyCommunityAdmins, type NotifyInput } from '@/lib/notify'

// Supabase quota alarms (S1-quota-alarms, backlog-batch1.23, database and
// storage only). The daily entitlements cron calls checkQuotaUsage with its
// service-role client. It reads public.platform_quota_usage() (migration
// platform_quota_usage) and, when either number passes its alarm, sends one
// alert a day to the admin alert recipients (lib/notify notifyCommunityAdmins).
//
// Egress and monthly active users are not covered: they are only readable
// through the Supabase Management API, which needs a token the owner holds.
//
// The client is a parameter, never created here, so this file does not add to
// the service-role inventory (test/baselines/service-role-files.json).

const MB = 1024 * 1024

/** The plan's database size limit: 500 MB. */
export const PLAN_DATABASE_LIMIT_BYTES = 500 * MB
/** The plan's file storage limit: 1 GB. */
export const PLAN_STORAGE_LIMIT_BYTES = 1024 * MB

/**
 * Alarm at 60% of the database limit: 300 MB of 500 MB. Early enough to find
 * and clear what is growing before the plan stops writes.
 */
export const DATABASE_ALARM_BYTES = 300 * MB
/**
 * Alarm at 60% of the storage limit, rounded to 600 MB of 1 GB (a touch under
 * the exact 614 MB, so it fires slightly early rather than late).
 */
export const STORAGE_ALARM_BYTES = 600 * MB

/** The cron_runs job whose result carries the last alert date (the host cron). */
const HOST_JOB = 'entitlements'

export interface QuotaUsage {
  databaseBytes: number
  storageBytes: number
}

export interface QuotaMeasure {
  bytes: number
  limitBytes: number
  alarmBytes: number
  /** Percent of the plan limit, one decimal place. */
  percent: number
  over: boolean
}

export interface QuotaEvaluation {
  database: QuotaMeasure
  storage: QuotaMeasure
  over: boolean
}

function measure(bytes: number, limitBytes: number, alarmBytes: number): QuotaMeasure {
  return {
    bytes,
    limitBytes,
    alarmBytes,
    percent: Math.round((bytes / limitBytes) * 1000) / 10,
    over: bytes >= alarmBytes,
  }
}

/** Pure threshold check: no I/O. */
export function evaluateQuota(usage: QuotaUsage): QuotaEvaluation {
  const database = measure(usage.databaseBytes, PLAN_DATABASE_LIMIT_BYTES, DATABASE_ALARM_BYTES)
  const storage = measure(usage.storageBytes, PLAN_STORAGE_LIMIT_BYTES, STORAGE_ALARM_BYTES)
  return { database, storage, over: database.over || storage.over }
}

/** Whole megabytes, for the alert text. */
export function toMb(bytes: number): number {
  return Math.round(bytes / MB)
}

/** The alert for an evaluation that is over. Numbers only: no names or ids of people. */
export function quotaAlert(evaluation: QuotaEvaluation): NotifyInput {
  const lines: string[] = []
  const describe = (label: string, m: QuotaMeasure) =>
    `${label} is at ${toMb(m.bytes)} MB of ${toMb(m.limitBytes)} MB (${m.percent}%), past the alarm at ${toMb(m.alarmBytes)} MB.`
  if (evaluation.database.over) lines.push(describe('The database', evaluation.database))
  if (evaluation.storage.over) lines.push(describe('File storage', evaluation.storage))
  const body =
    `Supabase quota alarm. ${lines.join(' ')} ` +
    'Find what is growing and clear it, or plan an upgrade, before the plan limit is reached.'
  const subject =
    evaluation.database.over && evaluation.storage.over
      ? 'Supabase database and storage past 60% of the plan'
      : evaluation.database.over
        ? 'Supabase database past 60% of the plan'
        : 'Supabase storage past 60% of the plan'
  const html = `<p>Supabase quota alarm.</p>${lines.map((l) => `<p>${l}</p>`).join('')}<p>Find what is growing and clear it, or plan an upgrade, before the plan limit is reached.</p>`
  return { type: 'action', body, email: { subject, html, text: body } }
}

/** UTC calendar date, YYYY-MM-DD. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** PostgREST's "no such function" (PGRST202) or Postgres's undefined_function (42883). */
export function isFunctionMissing(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883'
}

export type QuotaOutcome =
  | { skipped: 'function_missing' }
  | {
      databaseBytes: number
      storageBytes: number
      databasePercent: number
      storagePercent: number
      over: ('database' | 'storage')[]
      /** True when this run sent the alert. */
      alerted: boolean
      /** The UTC day an alert was last sent, carried from run to run so a second run that day stays quiet. */
      alertedOn?: string
      /** Why an over-threshold run did not alert. */
      alertSkipped?: 'already_alerted_today'
      /** The alert was due but could not be sent. */
      alertFailed?: true
    }

export interface CheckQuotaOptions {
  now?: Date
  /** The admin alert sender. notifyCommunityAdmins unless a test passes another. */
  notify?: (notice: NotifyInput) => Promise<void>
  /** The UTC day of the last alert. Read from the host cron's last finished run unless passed. */
  lastAlertedOn?: () => Promise<string | null>
}

async function lastAlertedOnFromLedger(db: SupabaseClient): Promise<string | null> {
  const result = await lastCronResult(db, HOST_JOB)
  const quota = result?.quota as { alertedOn?: unknown } | undefined
  return typeof quota?.alertedOn === 'string' ? quota.alertedOn : null
}

/**
 * Read the usage, and alert the admins once a day while either number is past
 * its alarm. A missing function (migration not applied yet) is a skip, not a
 * failure. Any other read error throws: the caller records it on its run.
 */
export async function checkQuotaUsage(db: SupabaseClient, opts: CheckQuotaOptions = {}): Promise<QuotaOutcome> {
  const now = opts.now ?? new Date()
  const { data, error } = await db.rpc('platform_quota_usage')
  if (error) {
    if (isFunctionMissing(error)) return { skipped: 'function_missing' }
    throw new Error(`platform_quota_usage: ${error.code ?? ''} ${error.message ?? ''}`.trim())
  }
  const row = (Array.isArray(data) ? data[0] : data) as { database_bytes?: unknown; storage_bytes?: unknown } | null
  const databaseBytes = Number(row?.database_bytes)
  const storageBytes = Number(row?.storage_bytes)
  if (!row || !Number.isFinite(databaseBytes) || !Number.isFinite(storageBytes)) {
    throw new Error('platform_quota_usage: no usable row returned')
  }

  const evaluation = evaluateQuota({ databaseBytes, storageBytes })
  const base = {
    databaseBytes,
    storageBytes,
    databasePercent: evaluation.database.percent,
    storagePercent: evaluation.storage.percent,
    over: [
      ...(evaluation.database.over ? (['database'] as const) : []),
      ...(evaluation.storage.over ? (['storage'] as const) : []),
    ],
  }
  if (!evaluation.over) return { ...base, alerted: false }

  const today = utcDay(now)
  const last = await (opts.lastAlertedOn ?? (() => lastAlertedOnFromLedger(db)))()
  if (last === today) {
    return { ...base, alerted: false, alertedOn: today, alertSkipped: 'already_alerted_today' }
  }

  try {
    await (opts.notify ?? notifyCommunityAdmins)(quotaAlert(evaluation))
  } catch (err) {
    console.error('[quota-alarms] could not alert admins:', err)
    return { ...base, alerted: false, alertFailed: true }
  }
  return { ...base, alerted: true, alertedOn: today }
}
