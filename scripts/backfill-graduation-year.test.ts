// @vitest-environment node
//
// alumni.mentor-upgrade (REG-23): the graduation-year backfill. The guards
// (an explicit --env-file, production, unknown flags), the per-row plan, the
// report (counts and ids only), and runs over a stand-in client: report mode
// writes nothing, --apply fills only years still NULL. No database is touched.
import { describe, expect, it } from 'vitest'
import {
  argRefusal,
  backfill,
  envRefusal,
  formatReport,
  parseArgs,
  planRow,
  type BackfillDb,
  type MemberRow,
  type Options,
} from './backfill-graduation-year'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

const NOV_2026 = new Date(Date.UTC(2026, 10, 14))
const opts = (o: Partial<Options> = {}): Options => ({ envFile: '.env.local', apply: false, production: false, batch: 500, ...o })

describe('parseArgs', () => {
  it('defaults to report only, with no env file', () => {
    expect(parseArgs([])).toEqual({ envFile: null, apply: false, production: false, batch: 500 })
  })

  it('reads every flag', () => {
    expect(parseArgs(['--env-file', '.env.dev', '--apply', '--production', '--batch', '50'])).toEqual({
      envFile: '.env.dev', apply: true, production: true, batch: 50,
    })
  })

  it('refuses an unknown flag, so a typo is never a quiet report', () => {
    expect(parseArgs(['--env-file', '.env.local', '--aply'])).toEqual({ error: 'Unknown argument: --aply' })
  })

  it('refuses --env-file without a path, and a bad batch', () => {
    expect(parseArgs(['--env-file'])).toHaveProperty('error')
    expect(parseArgs(['--env-file', '--apply'])).toHaveProperty('error')
    expect(parseArgs(['--batch', '0'])).toHaveProperty('error')
    expect(parseArgs(['--batch', 'many'])).toHaveProperty('error')
  })
})

describe('guards', () => {
  it('refuses to run without an explicit --env-file', () => {
    expect(argRefusal(opts({ envFile: null }), () => true)).toMatch(/without --env-file/)
  })

  it('refuses an env file that does not exist', () => {
    expect(argRefusal(opts({ envFile: 'missing.env' }), () => false)).toBe('No such env file: missing.env')
    expect(argRefusal(opts(), () => true)).toBeNull()
  })

  it('refuses the production project without --production', () => {
    const prod = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`
    expect(envRefusal(opts({ apply: true }), prod)).toMatch(/PRODUCTION/)
    expect(envRefusal(opts({ apply: true, production: true }), prod)).toBeNull()
    expect(envRefusal(opts(), 'https://dev-placeholder.supabase.co')).toBeNull()
    expect(envRefusal(opts(), undefined)).toMatch(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})

describe('planRow', () => {
  const row = (grade: string | null, age_bracket: string | null = 'high_school'): MemberRow => ({ id: 'm', grade, age_bracket })

  it('derives the year from a school grade with the school-year rule', () => {
    expect(planRow(row('grade_12'), NOV_2026)).toEqual({ year: 2027 })
    expect(planRow(row('grade_9'), NOV_2026)).toEqual({ year: 2030 })
    expect(planRow(row('grade_7', null), NOV_2026)).toEqual({ year: 2032 })
  })

  it('skips college grades and members who are not school students', () => {
    expect(planRow(row('college_freshman', 'college'), NOV_2026)).toEqual({ skip: 'not_a_school_student' })
    expect(planRow(row('grade_12', 'adult'), NOV_2026)).toEqual({ skip: 'not_a_school_student' })
    expect(planRow(row('college_junior', null), NOV_2026)).toEqual({ skip: 'not_a_school_grade' })
    expect(planRow(row('banana'), NOV_2026)).toEqual({ skip: 'not_a_school_grade' })
  })
})

/** A stand-in client over an in-memory members table. Records every read filter and write. */
type Row = MemberRow & { graduation_year: number | null; is_active?: boolean; deleted_at?: string | null }
const col = (r: Row, c: string) => (r as unknown as Record<string, unknown>)[c]

function standIn(rows: Row[]) {
  const writes: Array<{ patch: { graduation_year: number }; ids: string[] }> = []
  const filters: string[] = []
  const db: BackfillDb = {
    from: () => ({
      select: () => {
        let out = [...rows]
        let limit = Infinity
        const q = {
          is: (c: string, v: null) => { filters.push(`is ${c}`); out = out.filter((r) => col(r, c) == v); return q },
          not: (c: string) => { filters.push(`not ${c}`); out = out.filter((r) => col(r, c) != null); return q },
          eq: (c: string, v: unknown) => { filters.push(`eq ${c}`); out = out.filter((r) => (col(r, c) ?? true) === v); return q },
          gt: (_c: string, v: string) => { out = out.filter((r) => r.id > v); return q },
          order: () => { out.sort((a, b) => a.id.localeCompare(b.id)); return q },
          limit: (n: number) => { limit = n; return q },
          then: (f: (v: unknown) => unknown) =>
            Promise.resolve({ data: out.slice(0, limit).map(({ id, grade, age_bracket }) => ({ id, grade, age_bracket })), error: null }).then(f),
        }
        return q as never
      },
      update: (patch) => ({
        in: (_c, ids) => ({
          is: () => ({
            select: () => {
              writes.push({ patch, ids })
              const hit = rows.filter((r) => ids.includes(r.id) && r.graduation_year === null)
              for (const r of hit) r.graduation_year = patch.graduation_year
              return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
            },
          }),
        }),
      }),
    }),
  }
  return { db, writes, filters }
}

const fixture = (): Row[] => [
  { id: 'a1', grade: 'grade_12', age_bracket: 'high_school', graduation_year: null },
  { id: 'a2', grade: 'grade_10', age_bracket: 'high_school', graduation_year: null },
  { id: 'a3', grade: 'grade_10', age_bracket: null, graduation_year: null },
  { id: 'b1', grade: 'college_sophomore', age_bracket: 'college', graduation_year: null },
  { id: 'c1', grade: 'grade_9', age_bracket: 'high_school', graduation_year: 2030 },
  { id: 'd1', grade: null, age_bracket: 'high_school', graduation_year: null },
  { id: 'e1', grade: 'grade_11', age_bracket: 'high_school', graduation_year: null, is_active: false },
  { id: 'f1', grade: 'grade_11', age_bracket: 'high_school', graduation_year: null, deleted_at: '2026-01-01' },
]

describe('backfill', () => {
  it('report mode writes nothing and lists ids by year', async () => {
    const { db, writes, filters } = standIn(fixture())
    const r = await backfill(db, { apply: false, batch: 500 }, NOV_2026)
    expect(writes).toEqual([])
    expect(r.updated).toBe(0)
    expect(r.scanned).toBe(4)
    expect(Object.fromEntries(r.byYear)).toEqual({ 2027: ['a1'], 2029: ['a2', 'a3'] })
    expect(r.skipped).toEqual({ not_a_school_student: 1, not_a_school_grade: 0 })
    // Only NULL years, a grade on file, active and not deleted are read.
    expect(filters).toEqual(expect.arrayContaining(['is graduation_year', 'not grade', 'eq is_active', 'is deleted_at']))
  })

  it('pages through the table by id', async () => {
    const { db } = standIn(fixture())
    const r = await backfill(db, { apply: false, batch: 1 }, NOV_2026)
    expect(r.scanned).toBe(4)
    expect(Object.fromEntries(r.byYear)).toEqual({ 2027: ['a1'], 2029: ['a2', 'a3'] })
  })

  it('--apply fills each year once, only where it is still NULL, and a rerun writes nothing new', async () => {
    const rows = fixture()
    const { db, writes } = standIn(rows)
    const r = await backfill(db, { apply: true, batch: 500 }, NOV_2026)
    expect(r.updated).toBe(3)
    expect(r.failed).toBe(0)
    expect(writes).toEqual(expect.arrayContaining([
      { patch: { graduation_year: 2027 }, ids: ['a1'] },
      { patch: { graduation_year: 2029 }, ids: ['a2', 'a3'] },
    ]))
    expect(rows.find((x) => x.id === 'c1')!.graduation_year).toBe(2030)
    expect(rows.find((x) => x.id === 'b1')!.graduation_year).toBeNull()

    const again = await backfill(standIn(rows).db, { apply: true, batch: 500 }, NOV_2026)
    expect(again.scanned).toBe(1) // only the college row is still NULL with a grade
    expect(again.updated).toBe(0)
  })
})

describe('formatReport', () => {
  it('prints counts and member ids only', () => {
    const lines = formatReport(
      { scanned: 3, byYear: new Map([[2029, ['a2']], [2027, ['a1']]]), skipped: { not_a_school_grade: 0, not_a_school_student: 1 }, updated: 0, failed: 0 },
      false,
    )
    expect(lines[0]).toBe('3 member(s) read with a grade and no graduation year; 2 school student(s) to fill (report only: nothing written)')
    expect(lines.slice(2)).toEqual(['  2027: 1', '    a1', '  2029: 1', '    a2'])
  })
})
