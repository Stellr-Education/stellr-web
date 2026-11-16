// The cron ledger (S5 B26, the rest after B26a): reads cron_runs against the
// schedules in vercel.json and reports what the table alone cannot say at a
// glance. Pure: scripts/cron-ledger.ts does the read-only query and prints this.
//
//   dead     a run that started and never finished, older than its route's
//            maxDuration plus a margin. The platform killed it, or its instance
//            died. The DocuSign crons were dead this way for weeks in Sept 2026
//            (started rows, no finish, nothing in the logs Hobby keeps).
//   missed   a scheduled slot with no started top-level row in its window. The
//            cron never ran at all, so not even a dead row exists.
//   failed   a run that finished with ok not true: it recorded a failure.
//
// Per-tenant child rows (startTenantRun) are read for dead and failed, and never
// count as a started run for a slot: a slot is the platform calling the route.
//
// Vercel Hobby fires a cron at some point within the scheduled hour, not on the
// minute, so a slot's window is an hour plus a margin by default.

import { cronRunState, distinctFailures, type CronFailure, type CronRunRow } from './cron-runs'

/** One entry of vercel.json `crons`. */
export interface CronScheduleEntry {
  path: string
  schedule: string
}

export interface CronLedgerOptions {
  now: Date
  /** Ledger rows to check. Read the window back to `since` and a little before. */
  runs: readonly CronRunRow[]
  schedules: readonly CronScheduleEntry[]
  /** Each route's maxDuration, in seconds, by job name. */
  maxDurationS: Readonly<Record<string, number>>
  /** Slots from here to now are checked for missed runs. */
  since: Date
  /** Added to maxDuration before an unfinished run counts as dead. Default 5 minutes. */
  deadMarginMs?: number
  /** How long after a slot's start its run may begin. Default 75 minutes (Hobby fires within the hour). */
  slotWindowMs?: number
  /** For a job with no maxDuration in the map. Default 300 s, Vercel's ceiling on this plan. */
  defaultMaxDurationS?: number
}

export interface DeadRun {
  id: string
  job: string
  startedAt: string
  tenantId: string | null
  parentId: string | null
  /** Minutes past maxDuration plus margin. */
  overdueMinutes: number
}

export interface MissedRun {
  job: string
  path: string
  schedule: string
  /** The slot's start (UTC). */
  slot: string
}

export interface FailedRun {
  id: string
  job: string
  startedAt: string
  finishedAt: string
  tenantId: string | null
  parentId: string | null
  /** The first few distinct failures it recorded (as reported to app_errors). */
  failures: CronFailure[]
}

export interface CronLedgerReport {
  asOf: string
  since: string
  dead: DeadRun[]
  missed: MissedRun[]
  failed: FailedRun[]
  /** Runs still inside their time limit. Not a problem; shown so a count adds up. */
  running: number
}

const MINUTE = 60_000
const DEFAULT_DEAD_MARGIN_MS = 5 * MINUTE
const DEFAULT_SLOT_WINDOW_MS = 75 * MINUTE
const DEFAULT_MAX_DURATION_S = 300

/** The job name a route records under: /api/cron/<job>. Every cron route uses its path segment (weekly-digest's JOB included). */
export function jobOfPath(path: string): string | null {
  const m = /^\/api\/cron\/([a-z0-9-]+)$/.exec(path)
  return m ? m[1] : null
}

// ── Cron expressions ─────────────────────────────────────────────────────────

interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  dayOfWeek: Set<number>
  /** Both day fields restricted: standard cron matches either. */
  eitherDay: boolean
}

function field(raw: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>()
  for (const part of raw.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) throw new Error(`cron ${name}: bad step in "${raw}"`)
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      lo = a
      hi = b
    } else {
      lo = Number(range)
      hi = stepRaw === undefined ? lo : max
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`cron ${name}: "${raw}" is outside ${min}-${max}`)
    }
    for (let v = lo; v <= hi; v += step) out.add(name === 'day of week' && v === 7 ? 0 : v)
  }
  return out
}

/** Parses a five-field cron expression (numbers, *, lists, ranges, steps). Throws on anything else. */
export function parseCronSchedule(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron "${expr}": expected 5 fields`)
  const [m, h, dom, mon, dow] = parts
  return {
    minute: field(m, 0, 59, 'minute'),
    hour: field(h, 0, 23, 'hour'),
    dayOfMonth: field(dom, 1, 31, 'day of month'),
    month: field(mon, 1, 12, 'month'),
    dayOfWeek: field(dow, 0, 7, 'day of week'),
    eitherDay: dom !== '*' && dow !== '*',
  }
}

function matchesDay(f: CronFields, d: Date): boolean {
  const dom = f.dayOfMonth.has(d.getUTCDate())
  const dow = f.dayOfWeek.has(d.getUTCDay())
  return f.eitherDay ? dom || dow : dom && dow
}

/** Every time `expr` fires (UTC, on the minute) in [from, to). */
export function cronSlots(expr: string, from: Date, to: Date): Date[] {
  const f = parseCronSchedule(expr)
  const out: Date[] = []
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const hours = [...f.hour].sort((a, b) => a - b)
  const minutes = [...f.minute].sort((a, b) => a - b)
  for (; day.getTime() < to.getTime(); day.setUTCDate(day.getUTCDate() + 1)) {
    if (!f.month.has(day.getUTCMonth() + 1) || !matchesDay(f, day)) continue
    for (const h of hours) {
      for (const m of minutes) {
        const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m)
        if (t >= from.getTime() && t < to.getTime()) out.push(new Date(t))
      }
    }
  }
  return out
}

// ── maxDuration ──────────────────────────────────────────────────────────────

/** A route's `export const maxDuration = N`, or null when it sets none. */
export function maxDurationFromSource(source: string): number | null {
  const m = /^export const maxDuration\s*=\s*(\d+)\s*$/m.exec(source)
  return m ? Number(m[1]) : null
}

// ── The report ───────────────────────────────────────────────────────────────

export function buildCronLedger(opts: CronLedgerOptions): CronLedgerReport {
  const now = opts.now
  const deadMargin = opts.deadMarginMs ?? DEFAULT_DEAD_MARGIN_MS
  const slotWindow = opts.slotWindowMs ?? DEFAULT_SLOT_WINDOW_MS
  const fallbackS = opts.defaultMaxDurationS ?? DEFAULT_MAX_DURATION_S
  const limitMs = (job: string) => (opts.maxDurationS[job] ?? fallbackS) * 1000 + deadMargin

  const dead: DeadRun[] = []
  const failed: FailedRun[] = []
  let running = 0
  for (const r of opts.runs) {
    const state = cronRunState(r, now, limitMs(r.job))
    if (state === 'running') running++
    else if (state === 'dead') {
      const started = Date.parse(r.started_at)
      dead.push({
        id: r.id,
        job: r.job,
        startedAt: r.started_at,
        tenantId: r.tenant_id ?? null,
        parentId: r.parent_id ?? null,
        overdueMinutes: Number.isNaN(started) ? 0 : Math.floor((now.getTime() - started - limitMs(r.job)) / MINUTE),
      })
    } else if (state === 'failed') {
      failed.push({
        id: r.id,
        job: r.job,
        startedAt: r.started_at,
        finishedAt: r.finished_at as string,
        tenantId: r.tenant_id ?? null,
        parentId: r.parent_id ?? null,
        failures: distinctFailures(r.errors),
      })
    }
  }

  // A slot is met by a top-level row of its job started inside its window. Each
  // row meets one slot at most, so three daily slots need three rows.
  const startsByJob = new Map<string, number[]>()
  for (const r of opts.runs) {
    if (r.parent_id) continue
    const t = Date.parse(r.started_at)
    if (Number.isNaN(t)) continue
    startsByJob.set(r.job, [...(startsByJob.get(r.job) ?? []), t])
  }
  const slots: { job: string; path: string; schedule: string; at: Date }[] = []
  for (const s of opts.schedules) {
    const job = jobOfPath(s.path)
    if (!job) continue
    // Only slots whose whole window has passed: a run may still be on its way.
    for (const at of cronSlots(s.schedule, opts.since, new Date(now.getTime() - slotWindow))) slots.push({ job, path: s.path, schedule: s.schedule, at })
  }
  slots.sort((a, b) => a.at.getTime() - b.at.getTime() || a.job.localeCompare(b.job))
  const used = new Set<string>()
  const missed: MissedRun[] = []
  for (const slot of slots) {
    const starts = (startsByJob.get(slot.job) ?? []).map((t, i) => ({ t, key: `${slot.job}#${i}` }))
    const hit = starts
      .filter((s) => !used.has(s.key) && s.t >= slot.at.getTime() && s.t < slot.at.getTime() + slotWindow)
      .sort((a, b) => a.t - b.t)[0]
    if (hit) used.add(hit.key)
    else missed.push({ job: slot.job, path: slot.path, schedule: slot.schedule, slot: slot.at.toISOString() })
  }

  const byStart = <T extends { startedAt: string }>(a: T, b: T) => a.startedAt.localeCompare(b.startedAt)
  return { asOf: now.toISOString(), since: opts.since.toISOString(), dead: dead.sort(byStart), missed, failed: failed.sort(byStart), running }
}

/** Plain text for a terminal. Prints ids and job names only: never a run's result or error text beyond its label. */
export function formatCronLedger(report: CronLedgerReport): string {
  const lines = [`Cron ledger ${report.since} to ${report.asOf}`]
  lines.push('', `Dead (started, never finished): ${report.dead.length}`)
  for (const d of report.dead) {
    const scope = d.parentId ? ` tenant ${d.tenantId ?? '?'} of run ${d.parentId}` : ''
    lines.push(`  ${d.startedAt}  ${d.job}  ${d.id}${scope}  (${d.overdueMinutes} min past its limit)`)
  }
  lines.push('', `Missed (no run in the slot's window): ${report.missed.length}`)
  for (const m of report.missed) lines.push(`  ${m.slot}  ${m.job}  (${m.schedule})`)
  lines.push('', `Failed (finished, not ok): ${report.failed.length}`)
  for (const f of report.failed) {
    const scope = f.parentId ? ` tenant ${f.tenantId ?? '?'} of run ${f.parentId}` : ''
    lines.push(`  ${f.startedAt}  ${f.job}  ${f.id}${scope}`)
    for (const e of f.failures) lines.push(`      ${e.where}`)
  }
  lines.push('', `Still running, inside their limit: ${report.running}`)
  return lines.join('\n')
}

// ── The script's arguments ───────────────────────────────────────────────────

export type LedgerEnv = 'dev' | 'prod'

export interface CronLedgerArgs {
  env: LedgerEnv
  /** How far back to look, in hours. */
  hours: number
  json: boolean
}

/** Parses scripts/cron-ledger.ts's arguments. `--env dev|prod` is required: there is no default target. */
export function parseCronLedgerArgs(argv: readonly string[]): CronLedgerArgs {
  let env: string | null = null
  let hours = 48
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = (name: string) => {
      const eq = a.indexOf('=')
      if (eq !== -1) return a.slice(eq + 1)
      const next = argv[++i]
      if (next === undefined) throw new Error(`${name} needs a value`)
      return next
    }
    if (a === '--env' || a.startsWith('--env=')) env = value('--env')
    else if (a === '--hours' || a.startsWith('--hours=')) hours = Number(value('--hours'))
    else if (a === '--json') json = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (env !== 'dev' && env !== 'prod') throw new Error('refusing: pass --env dev or --env prod (there is no default)')
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 31) throw new Error('--hours must be between 0 and 744')
  return { env, hours, json }
}

/**
 * The database URL must be the environment asked for: a prod URL names the
 * production project ref, a dev URL must not. Throws otherwise, before anything
 * connects. Never echoes the URL.
 */
export function assertLedgerTarget(env: LedgerEnv, url: string | undefined, productionRef: string): string {
  if (!url) throw new Error('CRON_LEDGER_DATABASE_URL is not set')
  const namesProd = url.includes(productionRef)
  if (env === 'prod' && !namesProd) throw new Error('refusing: --env prod, but CRON_LEDGER_DATABASE_URL does not name the production project')
  if (env === 'dev' && namesProd) throw new Error('refusing: --env dev, but CRON_LEDGER_DATABASE_URL names the production project')
  return url
}
