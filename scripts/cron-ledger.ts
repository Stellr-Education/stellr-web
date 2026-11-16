/**
 * cron-ledger.ts — print the cron ledger (lib/cron-ledger.ts): dead runs
 * (started, never finished), missed slots (no run at all) and failed runs, from
 * cron_runs and the schedules in vercel.json.
 *
 *   CRON_LEDGER_SUPABASE_URL=… CRON_LEDGER_SUPABASE_KEY=… \
 *     npx tsx scripts/cron-ledger.ts --env dev [--hours 48] [--json]
 *
 * Read-only: it pages through cron_runs with select() and calls nothing else
 * (lib/cron-ledger.test.ts holds the source to that). The variables are its
 * own, never .env.local's, so it cannot pick up a target by accident.
 * `--env dev|prod` is required, and the URL must match it: a prod URL names the
 * production project ref, a dev URL must not. There is no default target.
 *
 * Agents do not run this against a hosted database (CLAUDE.md, "Production SQL";
 * the owner runs it, or reads the same rows in the dashboard). CI never runs it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { assertLedgerTarget, buildCronLedger, formatCronLedger, jobOfPath, maxDurationFromSource, parseCronLedgerArgs, type CronScheduleEntry } from '../lib/cron-ledger'
import type { CronRunRow } from '../lib/cron-runs'
import { supabaseFetch } from '../lib/supabase-keys'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

/** Extra rows read before `since`, so a run that started just before it still counts for its slot. */
const LOOKBACK_SLACK_MS = 2 * 60 * 60 * 1000

/** Rows per page: PostgREST's default cap. */
const PAGE = 1000

function schedulesAndLimits(root: string): { schedules: CronScheduleEntry[]; maxDurationS: Record<string, number> } {
  const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { crons?: CronScheduleEntry[] }
  const schedules = vercel.crons ?? []
  const maxDurationS: Record<string, number> = {}
  const cronDir = join(root, 'app/api/cron')
  for (const name of readdirSync(cronDir)) {
    const route = join(cronDir, name, 'route.ts')
    if (!existsSync(route)) continue
    const s = maxDurationFromSource(readFileSync(route, 'utf8'))
    if (s !== null) maxDurationS[name] = s
  }
  for (const s of schedules) {
    if (!jobOfPath(s.path)) throw new Error(`vercel.json cron path ${s.path} is not /api/cron/<job>`)
  }
  return { schedules, maxDurationS }
}

async function main() {
  const args = parseCronLedgerArgs(process.argv.slice(2))
  const url = assertLedgerTarget(args.env, process.env.CRON_LEDGER_SUPABASE_URL, PRODUCTION_SUPABASE_REF)
  const key = process.env.CRON_LEDGER_SUPABASE_KEY
  if (!key) throw new Error('CRON_LEDGER_SUPABASE_KEY is not set')
  const { schedules, maxDurationS } = schedulesAndLimits(process.cwd())

  const now = new Date()
  const since = new Date(now.getTime() - args.hours * 60 * 60 * 1000)
  const from = new Date(since.getTime() - LOOKBACK_SLACK_MS)

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: supabaseFetch } })
  const runs: CronRunRow[] = []
  // `*`: parent_id and tenant_id exist once cron_runs_tenant has run, and the read
  // still works where they don't.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db
      .from('cron_runs')
      .select('*')
      .gte('started_at', from.toISOString())
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`reading cron_runs failed: ${error.message}`)
    runs.push(...((data ?? []) as CronRunRow[]))
    if (!data || data.length < PAGE) break
  }

  const report = buildCronLedger({ now, since, runs, schedules, maxDurationS })
  console.log(args.json ? JSON.stringify(report, null, 2) : formatCronLedger(report))
  if (report.dead.length || report.missed.length || report.failed.length) process.exitCode = 1
}

main().catch((err) => {
  console.error(`[cron-ledger] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
})
