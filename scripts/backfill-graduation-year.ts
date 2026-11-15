/**
 * Fill members.graduation_year from the grade, for school students who have a
 * grade on file and no graduation year (alumni.mentor-upgrade, REG-23).
 *
 * Why: the July-1 Alumni upgrade (app/api/cron/alumni-upgrades) reads
 * graduation_year, and until onboarding and the admin editor wrote it nothing
 * did, so the cron had no one to upgrade. New members now give it; this is the
 * one-off for the members already on file. docs/PLAN-former-student-mentor-
 * upgrade.md §3.
 *
 *   npx tsx scripts/backfill-graduation-year.ts --env-file .env.local            # report only (default): writes nothing
 *   npx tsx scripts/backfill-graduation-year.ts --env-file .env.local --apply    # write the years
 *   options: --production   required as well when the env file names the production project (owner only)
 *            --batch <n>    rows read per page (default 500, 1–1000)
 *
 * Which rows: active, not deleted, graduation_year NULL, a school grade (6–12)
 * on file, and an age bracket that is high school or not yet known. A college
 * grade or an adult/college bracket is skipped and counted.
 *
 * The year is the one rule lib/graduation-year.ts uses everywhere: grade 12
 * graduates in the current school year (named for the year it ends; August is
 * the cutover), grade 11 the year after, and so on. A grade that has gone stale
 * can only make the year later than the truth, never earlier, so this cannot
 * upgrade anyone to Alumni early.
 *
 * Guards: refuses to run without an explicit --env-file (nothing is read from
 * the shell's environment or a default file), refuses the production project
 * without --production, and refuses any flag it does not know (so `--aply` is
 * an error, not a report that looks like an apply). A write only fills a year
 * that is still NULL, so a rerun or a year set meanwhile is never overwritten.
 *
 * Prints counts and member ids only: never a name, an email or any other field.
 *
 * Env file needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'
import { graduationYearFromGrade } from '../lib/graduation-year'

// ── Arguments and guards ────────────────────────────────────────────────────

export interface Options {
  envFile: string | null
  apply: boolean
  production: boolean
  batch: number
}

/** Parse argv. Returns the options, or an error message to print. */
export function parseArgs(argv: readonly string[]): Options | { error: string } {
  const opts: Options = { envFile: null, apply: false, production: false, batch: 500 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') opts.apply = true
    else if (arg === '--production') opts.production = true
    else if (arg === '--env-file') {
      const raw = argv[++i]
      if (!raw || raw.startsWith('--')) return { error: '--env-file takes a path' }
      opts.envFile = raw
    } else if (arg === '--batch') {
      const raw = argv[++i]
      if (raw === undefined || !/^\d+$/.test(raw)) return { error: '--batch takes a whole number' }
      const n = Number(raw)
      if (n < 1 || n > 1000) return { error: '--batch must be between 1 and 1000' }
      opts.batch = n
    } else return { error: `Unknown argument: ${arg}` }
  }
  return opts
}

/** True when the Supabase URL's host names the production project. */
export function isProductionUrl(url: string): boolean {
  try {
    return new URL(url).host.toLowerCase().includes(PRODUCTION_SUPABASE_REF)
  } catch {
    return url.toLowerCase().includes(PRODUCTION_SUPABASE_REF)
  }
}

/** Why the run must not start before the env file is read, or null. */
export function argRefusal(opts: Options, fileExists: (p: string) => boolean = fs.existsSync): string | null {
  if (!opts.envFile) {
    return 'Refusing to run without --env-file <path>: name the project explicitly, e.g. --env-file .env.local.'
  }
  if (!fileExists(opts.envFile)) return `No such env file: ${opts.envFile}`
  return null
}

/** Why the run must not start once the env file is loaded, or null. */
export function envRefusal(opts: Options, url: string | undefined): string | null {
  if (!url) return 'NEXT_PUBLIC_SUPABASE_URL is not set in the env file.'
  if (isProductionUrl(url) && !opts.production) {
    return 'Refusing the PRODUCTION project without --production (an owner action).'
  }
  return null
}

// ── Planning ────────────────────────────────────────────────────────────────

export interface MemberRow {
  id: string
  grade: string | null
  age_bracket: string | null
}

export type Skip = 'not_a_school_grade' | 'not_a_school_student'

/** The year to write for one row, or why it is skipped. */
export function planRow(row: MemberRow, now: Date): { year: number } | { skip: Skip } {
  if (row.age_bracket === 'college' || row.age_bracket === 'adult') return { skip: 'not_a_school_student' }
  const year = graduationYearFromGrade(row.grade, now)
  return year === null ? { skip: 'not_a_school_grade' } : { year }
}

export interface Report {
  scanned: number
  /** Member ids to fill, by the year each gets. */
  byYear: Map<number, string[]>
  skipped: Record<Skip, number>
  updated: number
  failed: number
}

/** The lines to print: counts and member ids only. */
export function formatReport(r: Report, apply: boolean): string[] {
  const eligible = [...r.byYear.values()].reduce((n, ids) => n + ids.length, 0)
  const lines = [
    `${r.scanned} member(s) read with a grade and no graduation year; ${eligible} school student(s) to fill` +
      (apply ? `; ${r.updated} written, ${r.failed} failed` : ' (report only: nothing written)'),
    `  skipped: ${r.skipped.not_a_school_student} not a school student, ${r.skipped.not_a_school_grade} without a school grade`,
  ]
  for (const [year, ids] of [...r.byYear].sort(([a], [b]) => a - b)) {
    lines.push(`  ${year}: ${ids.length}`)
    for (const id of ids) lines.push(`    ${id}`)
  }
  return lines
}

// ── Running ─────────────────────────────────────────────────────────────────

type DbResult<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>

/** The slice of a Supabase client this script uses; tests stand one in. */
export interface BackfillDb {
  from(table: 'members'): {
    select(columns: string): ReadQuery
    update(patch: { graduation_year: number }): {
      in(column: 'id', ids: string[]): {
        is(column: 'graduation_year', value: null): {
          select(columns: 'id'): DbResult<Array<{ id: string }>>
        }
      }
    }
  }
}
export interface ReadQuery extends DbResult<MemberRow[]> {
  is(column: string, value: null): ReadQuery
  not(column: string, op: 'is', value: null): ReadQuery
  eq(column: string, value: unknown): ReadQuery
  gt(column: string, value: string): ReadQuery
  order(column: string, o: { ascending: boolean }): ReadQuery
  limit(n: number): ReadQuery
}

const WRITE_CHUNK = 100

export async function backfill(
  db: BackfillDb,
  opts: Pick<Options, 'apply' | 'batch'>,
  now: Date = new Date(),
): Promise<Report> {
  const r: Report = { scanned: 0, byYear: new Map(), skipped: { not_a_school_grade: 0, not_a_school_student: 0 }, updated: 0, failed: 0 }
  let last: string | null = null
  for (;;) {
    let q = db
      .from('members')
      .select('id, grade, age_bracket')
      .is('graduation_year', null)
      .not('grade', 'is', null)
      .eq('is_active', true)
      .is('deleted_at', null)
    if (last !== null) q = q.gt('id', last)
    const { data, error } = await q.order('id', { ascending: true }).limit(opts.batch)
    if (error) throw new Error(`Cannot read members (${error.code ?? 'unknown error'})`)
    const rows = data ?? []
    for (const row of rows) {
      r.scanned++
      const plan = planRow(row, now)
      if ('skip' in plan) {
        r.skipped[plan.skip]++
        continue
      }
      const ids = r.byYear.get(plan.year) ?? []
      ids.push(row.id)
      r.byYear.set(plan.year, ids)
    }
    if (rows.length < opts.batch) break
    last = rows[rows.length - 1].id
  }
  if (!opts.apply) return r

  for (const [year, ids] of r.byYear) {
    for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
      const chunk = ids.slice(i, i + WRITE_CHUNK)
      // Only a year still NULL is filled: one set meanwhile is never overwritten.
      const { data, error } = await db
        .from('members')
        .update({ graduation_year: year })
        .in('id', chunk)
        .is('graduation_year', null)
        .select('id')
      if (error) {
        r.failed += chunk.length
        continue
      }
      r.updated += data?.length ?? 0
    }
  }
  return r
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2))
  if ('error' in opts) {
    console.error(opts.error)
    return 1
  }
  const refusedArgs = argRefusal(opts)
  if (refusedArgs) {
    console.error(refusedArgs)
    return 1
  }
  const dotenv = await import('dotenv')
  // override: the named file wins over anything already in the shell.
  dotenv.config({ path: path.resolve(process.cwd(), opts.envFile!), override: true })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const refused = envRefusal(opts, url)
  if (refused) {
    console.error(refused)
    return 1
  }
  const { createClient } = await import('@supabase/supabase-js')
  const { supabaseFetch, supabaseSecretKey, SECRET_KEY_VARS } = await import('../lib/supabase-keys')
  const key = supabaseSecretKey()
  if (!key) {
    console.error(`${SECRET_KEY_VARS} is not set in the env file.`)
    return 1
  }
  const db = createClient(url!, key, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })

  console.log(`${opts.apply ? 'APPLY' : 'REPORT ONLY'} against ${isProductionUrl(url!) ? 'PRODUCTION' : 'a non-production project'} (${new URL(url!).host})\n`)
  const report = await backfill(db as unknown as BackfillDb, opts)
  for (const line of formatReport(report, opts.apply)) console.log(line)
  if (!opts.apply) console.log('\nReport only. Add --apply to write.')
  return report.failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : 'Backfill failed')
      process.exit(1)
    })
}
