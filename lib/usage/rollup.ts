// S6-USE: the daily usage roll-up, run by app/api/cron/usage-rollup.
//
// For yesterday and today (UTC) it calls public.usage_rollup(day), which sums
// usage_events per tenant and kind (and counts new members rows as the owner's
// identities) and upserts the totals into usage_daily. Re-running a day writes
// the same totals, so a retried or doubled run is harmless. Yesterday is re-rolled
// so a send recorded just before midnight is counted once its day is complete.
//
// Then it purges usage_events rows older than the 90-day raw window. The
// roll-ups are kept: usage_rollup never runs for a day that old (it refuses one),
// so a purged day's totals stay as they were rolled up.

import type { SupabaseClient } from '@supabase/supabase-js'

/** S6-Q6's default: raw usage_events are kept 90 days, daily roll-ups are kept. */
export const USAGE_RAW_RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

export interface UsageRollupResult {
  /** Rows usage_rollup wrote (one per tenant and kind with usage), per UTC day. */
  days: { day: string; rows: number | null }[]
  /** usage_events rows deleted as older than the raw window, or null when the purge failed. */
  purged: number | null
  failures: number
}

/** A UTC date as YYYY-MM-DD. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/** The days a run rolls up: yesterday and today, UTC. */
export function rollupDays(now: Date): string[] {
  return [utcDay(new Date(now.getTime() - DAY_MS)), utcDay(now)]
}

/** The purge cutoff: rows that occurred before it are outside the raw window. */
export function purgeCutoff(now: Date): string {
  return new Date(now.getTime() - USAGE_RAW_RETENTION_DAYS * DAY_MS).toISOString()
}

export async function runUsageRollup(
  db: SupabaseClient,
  opts: { now: Date; fail: (where: string, err: unknown) => void },
): Promise<UsageRollupResult> {
  const result: UsageRollupResult = { days: [], purged: null, failures: 0 }
  const fail = (where: string, err: unknown) => {
    result.failures++
    opts.fail(where, err)
  }

  for (const day of rollupDays(opts.now)) {
    const { data, error } = await db.rpc('usage_rollup', { p_day: day })
    if (error) {
      fail(`rollup:${day}`, error.message)
      result.days.push({ day, rows: null })
    } else {
      result.days.push({ day, rows: typeof data === 'number' ? data : Number(data ?? 0) })
    }
  }

  const { data: purged, error: purgeError } = await db
    .from('usage_events')
    .delete()
    .lt('occurred_at', purgeCutoff(opts.now))
    .select('id')
  if (purgeError) fail('purge', purgeError.message)
  else result.purged = (purged ?? []).length

  return result
}
