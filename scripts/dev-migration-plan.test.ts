// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PlanError,
  buildPlan,
  ledgerInsert,
  localMigrations,
  main,
  parseArgs,
  parseLedger,
  renderPlan,
  sqlLiteral,
} from './dev-migration-plan.mjs'

// s5-programme.46 (tooling only): the dev migration plan prints what is missing
// from a ledger and the ledger inserts to run after applying. It must never
// connect to or write a database, so these tests pin both the plan and the
// refusals.

const FIXTURES = 'scripts/fixtures/dev-migration-plan'
const DIR = `${FIXTURES}/migrations`
const SCRIPT = readFileSync('scripts/dev-migration-plan.mjs', 'utf8')

function run(argv: string[]) {
  let out = ''
  let err = ''
  const code = main(argv, {
    stdout: { write: (s: string) => ((out += s), true) } as unknown as NodeJS.WriteStream,
    stderr: { write: (s: string) => ((err += s), true) } as unknown as NodeJS.WriteStream,
  })
  return { code, out, err }
}

describe('never touches a database', () => {
  it('imports only node built-ins (no driver, no Supabase client, no child processes)', () => {
    const imports = [...SCRIPT.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports.length).toBeGreaterThan(0)
    for (const spec of imports) expect(['node:fs', 'node:path', 'node:url']).toContain(spec)
    expect(SCRIPT).not.toMatch(/\bimport\(/)
    expect(SCRIPT).not.toMatch(/require\(/)
    expect(SCRIPT).not.toMatch(/child_process|fetch\(|process\.env/)
  })

  it.each([
    ['postgresql://postgres:placeholder@localhost:54322/postgres'],
    ['postgres://user:placeholder@db.example.test:5432/postgres'],
    ['--db-url=postgresql://x'],
    ['--db-url'],
    ['--database-url'],
    ['host=localhost dbname=postgres'],
    ['https://example.test/ledger.json'],
  ])('refuses %s', (arg) => {
    expect(() => parseArgs(['--ledger', `${FIXTURES}/ledger-rows.json`, arg])).toThrow(PlanError)
    const r = run(['--ledger', `${FIXTURES}/ledger-rows.json`, '--migrations-dir', DIR, arg])
    expect(r.code).toBe(2)
    expect(r.out).toBe('')
    expect(r.err).toMatch(/Refusing to run/)
  })

  it('refuses a URL even in the --ledger position', () => {
    expect(() => parseArgs(['--ledger', 'postgresql://postgres:placeholder@127.0.0.1/postgres'])).toThrow(/Refusing/)
  })

  it('requires a ledger file', () => {
    expect(() => parseArgs([])).toThrow(/--ledger/)
  })
})

describe('parseLedger', () => {
  it('reads an array of versions, an array of rows, and a wrapped array', () => {
    expect([...parseLedger('["20261101000000", 20261102000000]')]).toEqual(['20261101000000', '20261102000000'])
    expect([...parseLedger('[{"version":"20261101000000","name":"a"}]')]).toEqual(['20261101000000'])
    expect([...parseLedger('{"rows":[{"version":"20261101000000"}]}')]).toEqual(['20261101000000'])
  })

  it('rejects invalid JSON and non-version entries', () => {
    expect(() => parseLedger('not json')).toThrow(PlanError)
    expect(() => parseLedger('{"x":1}')).toThrow(PlanError)
    expect(() => parseLedger('[{"name":"no version"}]')).toThrow(PlanError)
    expect(() => parseLedger('["drop table x"]')).toThrow(PlanError)
  })
})

describe('localMigrations', () => {
  const files = [
    '20261102000000_bravo.sql',
    '001_first.sql',
    '20261101000000_alpha.sql',
    'README.md',
    '20261103000000_charlie.SQL.bak',
  ]

  it('keeps timestamped migrations only by default, oldest first', () => {
    expect(localMigrations(files).map((m) => m.file)).toEqual(['20261101000000_alpha.sql', '20261102000000_bravo.sql'])
  })

  it('includes legacy 3-digit files before timestamped ones with includeLegacy', () => {
    expect(localMigrations(files, { includeLegacy: true }).map((m) => m.version)).toEqual(['001', '20261101000000', '20261102000000'])
  })

  it('splits version and name the way the Supabase ledger records them', () => {
    expect(localMigrations(['20261114175430_drop_staff_compat_views.sql'])[0]).toEqual({
      file: '20261114175430_drop_staff_compat_views.sql',
      version: '20261114175430',
      name: 'drop_staff_compat_views',
    })
  })

  it('refuses two files with one version', () => {
    expect(() => localMigrations(['20261101000000_a.sql', '20261101000000_b.sql'])).toThrow(/share version/)
  })
})

describe('ledger inserts', () => {
  it('prints the exact insert', () => {
    expect(ledgerInsert({ file: 'f', version: '20261102000000', name: 'bravo' })).toBe(
      "insert into supabase_migrations.schema_migrations (version, name) values ('20261102000000', 'bravo');",
    )
  })

  it('escapes single quotes', () => {
    expect(sqlLiteral("o'brien")).toBe("'o''brien'")
  })
})

describe('the plan on fixtures', () => {
  it('lists the missing files in apply order with one insert each, and flags out-of-order and unknown versions', () => {
    const r = run(['--ledger', `${FIXTURES}/ledger-rows.json`, '--migrations-dir', DIR])
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    expect(r.out).toContain('nothing was applied, nothing was connected to')
    expect(r.out).toContain('Local migrations missing from the ledger: 2')
    expect(r.out).toContain('  1. 20261102000000_bravo.sql\n  2. 20261104000000_delta.sql')
    expect(r.out).toContain(
      "insert into supabase_migrations.schema_migrations (version, name) values ('20261102000000', 'bravo');",
    )
    expect(r.out).toContain(
      "insert into supabase_migrations.schema_migrations (version, name) values ('20261104000000', 'delta');",
    )
    expect(r.out.match(/^insert into/gm)).toHaveLength(2)
    expect(r.out).not.toContain('alpha')
    expect(r.out).not.toContain('legacy')
    expect(r.out).toMatch(/WARNING: 1 missing migration\(s\) are older than the newest applied one \(20261103000000\):\n {2}- 20261102000000_bravo\.sql/)
    expect(r.out).toMatch(/NOTE: 1 ledger version\(s\) have no local file in the planned set:\n {2}- 20260101000000/)
  })

  it('accepts the ledger as a positional argument and lists legacy files on request', () => {
    const r = run([`${FIXTURES}/ledger-rows.json`, '--migrations-dir', DIR, '--include-legacy'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('  1. 001_first_legacy.sql\n  2. 002_second_legacy.sql\n  3. 20261102000000_bravo.sql')
    expect(r.out).toContain("values ('001', 'first_legacy');")
  })

  it('says there is nothing to apply when the ledger is complete', () => {
    const r = run(['--ledger', `${FIXTURES}/ledger-complete.json`, '--migrations-dir', DIR])
    expect(r.code).toBe(0)
    expect(r.out).toContain('Nothing to apply.')
    expect(r.out).not.toMatch(/^insert into/m)
  })

  it('reports a missing ledger file without a stack trace', () => {
    const r = run(['--ledger', `${FIXTURES}/does-not-exist.json`, '--migrations-dir', DIR])
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/File not found/)
  })

  it('renders a plan with no ledger rows at all', () => {
    const plan = buildPlan(localMigrations(['20261101000000_alpha.sql']), new Set())
    expect(plan.outOfOrder).toEqual([])
    expect(renderPlan(plan)).toContain('  1. 20261101000000_alpha.sql')
  })
})
