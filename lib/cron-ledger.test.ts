// @vitest-environment node
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALTERNATE_SCHEDULE_JOBS,
  assertLedgerTarget,
  buildCronLedger,
  cronSlots,
  formatCronLedger,
  jobOfPath,
  maxDurationFromSource,
  parseCronLedgerArgs,
  parseCronSchedule,
} from './cron-ledger'
import type { CronRunRow } from './cron-runs'

// The cron ledger (S5 B26): dead runs, missed slots and failed runs from
// cron_runs and vercel.json. Fixtures only; nothing here reads a database.

const NOW = new Date('2026-11-15T12:00:00Z')
const SINCE = new Date('2026-11-14T00:00:00Z')
const PARENT = '00000000-0000-4000-8000-0000000000aa'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'

let n = 0
function run(job: string, startedAt: string, finished: { at: string; ok: boolean; errors?: unknown } | null, extra: Partial<CronRunRow> = {}): CronRunRow {
  n++
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    job,
    started_at: startedAt,
    finished_at: finished?.at ?? null,
    ok: finished ? finished.ok : null,
    result: finished ? {} : {},
    errors: finished?.errors ?? [],
    tenant_id: null,
    parent_id: null,
    ...extra,
  }
}

const daily = (job: string, schedule: string) => ({ path: `/api/cron/${job}`, schedule })

describe('cron expressions', () => {
  it('parses the shapes vercel.json uses', () => {
    const f = parseCronSchedule('45 9 * * *')
    expect([...f.minute]).toEqual([45])
    expect([...f.hour]).toEqual([9])
    expect(parseCronSchedule('0 18 * * 5').dayOfWeek).toEqual(new Set([5]))
    expect(parseCronSchedule('0 3 2 * *').dayOfMonth).toEqual(new Set([2]))
    expect([...parseCronSchedule('*/15 0-1 * * *').minute]).toEqual([0, 15, 30, 45])
    expect(parseCronSchedule('0 0 * * 7').dayOfWeek).toEqual(new Set([0]))
  })

  it('refuses what it does not understand rather than guessing', () => {
    expect(() => parseCronSchedule('0 9 * *')).toThrow(/5 fields/)
    expect(() => parseCronSchedule('60 9 * * *')).toThrow(/outside/)
    expect(() => parseCronSchedule('0 9 * * MON')).toThrow()
    expect(() => parseCronSchedule('*/0 9 * * *')).toThrow(/step/)
  })

  it('lists the slots in a window, daily, weekly and monthly', () => {
    expect(cronSlots('0 9 * * *', SINCE, NOW).map((d) => d.toISOString())).toEqual(['2026-11-14T09:00:00.000Z', '2026-11-15T09:00:00.000Z'])
    // 14 Nov 2026 is a Saturday, 13 Nov a Friday.
    expect(cronSlots('0 18 * * 5', new Date('2026-11-08T00:00:00Z'), NOW).map((d) => d.toISOString())).toEqual(['2026-11-13T18:00:00.000Z'])
    expect(cronSlots('0 3 2 * *', new Date('2026-10-01T00:00:00Z'), NOW).map((d) => d.toISOString())).toEqual([
      '2026-10-02T03:00:00.000Z',
      '2026-11-02T03:00:00.000Z',
    ])
    // Either day field matches when both are restricted, as cron does.
    expect(cronSlots('0 0 1 * 0', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-09T00:00:00Z')).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-11-01',
      '2026-11-08',
    ])
  })

  it('parses every schedule in vercel.json, and every path names its job', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] }
    expect(vercel.crons.length).toBeGreaterThan(0)
    for (const c of vercel.crons) {
      expect(() => parseCronSchedule(c.schedule), c.schedule).not.toThrow()
      expect(jobOfPath(c.path), c.path).toMatch(/^[a-z0-9-]+$/)
    }
    expect(jobOfPath('/api/admin/x')).toBeNull()
  })
})

describe('maxDuration', () => {
  it('reads the route export, and null when there is none', () => {
    expect(maxDurationFromSource("import x from 'y'\nexport const maxDuration = 300\n")).toBe(300)
    expect(maxDurationFromSource('// export const maxDuration = 60 is not set here\n')).toBeNull()
    expect(maxDurationFromSource('const maxDuration = 60\n')).toBeNull()
  })

  it('finds one in every scheduled cron route', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }
    for (const job of new Set(vercel.crons.map((c) => jobOfPath(c.path) as string))) {
      const route = `app/api/cron/${job}/route.ts`
      expect(existsSync(route), route).toBe(true)
      expect(maxDurationFromSource(readFileSync(route, 'utf8')), route).toBeGreaterThan(0)
    }
    expect(readdirSync('app/api/cron').length).toBeGreaterThan(0)
  })
})

describe('dead runs', () => {
  it('reports the DocuSign-cron-dead pattern: started every day, never finished', () => {
    const runs = [
      run('docusign-reminders', '2026-11-14T09:00:04Z', null),
      run('docusign-reminders', '2026-11-15T09:00:03Z', null),
      run('docusign-form-data', '2026-11-14T09:15:02Z', null),
      run('docusign-form-data', '2026-11-15T09:15:05Z', null),
    ]
    const report = buildCronLedger({
      now: NOW,
      since: SINCE,
      runs,
      schedules: [daily('docusign-reminders', '0 9 * * *'), daily('docusign-form-data', '15 9 * * *')],
      maxDurationS: { 'docusign-reminders': 300, 'docusign-form-data': 300 },
    })
    expect(report.dead.map((d) => [d.job, d.startedAt])).toEqual([
      ['docusign-reminders', '2026-11-14T09:00:04Z'],
      ['docusign-form-data', '2026-11-14T09:15:02Z'],
      ['docusign-reminders', '2026-11-15T09:00:03Z'],
      ['docusign-form-data', '2026-11-15T09:15:05Z'],
    ])
    // The rows exist, so the slots were not missed: the runs started and died.
    expect(report.missed).toEqual([])
    expect(report.failed).toEqual([])
    // 12:00 - 09:00:03 - (300 s + 5 min) = 169 minutes and change.
    expect(report.dead[2].overdueMinutes).toBe(169)
  })

  it('a run inside maxDuration plus the margin is running, not dead', () => {
    const report = buildCronLedger({
      now: NOW,
      since: SINCE,
      runs: [run('surveys', '2026-11-15T11:55:30Z', null), run('surveys', '2026-11-15T11:53:59Z', null)],
      schedules: [],
      maxDurationS: { surveys: 60 },
    })
    // 60 s + 5 min margin = 6 minutes.
    expect(report.running).toBe(1)
    expect(report.dead.map((d) => d.startedAt)).toEqual(['2026-11-15T11:53:59Z'])
  })

  it('uses the default limit for a job with no maxDuration, and names a dead tenant child with its parent', () => {
    const report = buildCronLedger({
      now: NOW,
      since: SINCE,
      runs: [
        run('event-emails', '2026-11-15T10:00:00Z', { at: '2026-11-15T10:00:50Z', ok: false }, { id: PARENT }),
        run('event-emails', '2026-11-15T10:00:20Z', null, { parent_id: PARENT, tenant_id: TENANT_B }),
        run('rate-limit-gc', '2026-11-15T11:56:00Z', null),
      ],
      schedules: [],
      maxDurationS: { 'event-emails': 60 },
    })
    expect(report.dead).toEqual([
      expect.objectContaining({ job: 'event-emails', parentId: PARENT, tenantId: TENANT_B }),
    ])
    expect(report.running).toBe(1)
    expect(formatCronLedger(report)).toContain(`tenant ${TENANT_B} of run ${PARENT}`)
  })
})

describe('missed runs', () => {
  it('reports a slot with no started row, and only slots whose window has passed', () => {
    const report = buildCronLedger({
      now: NOW,
      since: SINCE,
      runs: [run('group-invoice-sync', '2026-11-14T09:52:00Z', { at: '2026-11-14T09:53:00Z', ok: true })],
      schedules: [daily('group-invoice-sync', '45 9 * * *'), daily('apollo-reconcile', '0 11 * * *')],
      maxDurationS: {},
    })
    // 15 Nov 09:45's window ended 11:00; 15 Nov 11:00's is still open at 12:00.
    expect(report.missed).toEqual([
      { job: 'apollo-reconcile', path: '/api/cron/apollo-reconcile', schedule: '0 11 * * *', slot: '2026-11-14T11:00:00.000Z' },
      { job: 'group-invoice-sync', path: '/api/cron/group-invoice-sync', schedule: '45 9 * * *', slot: '2026-11-15T09:45:00.000Z' },
    ])
  })

  it('takes Hobby firing late in the hour as on time, but a run before the slot never counts', () => {
    const report = buildCronLedger({
      now: NOW,
      since: new Date('2026-11-15T00:00:00Z'),
      runs: [run('entitlements', '2026-11-15T05:58:00Z', { at: '2026-11-15T05:59:00Z', ok: true }), run('membership-expiry', '2026-11-15T05:59:00Z', { at: '2026-11-15T06:00:00Z', ok: true })],
      schedules: [daily('entitlements', '0 5 * * *'), daily('membership-expiry', '0 6 * * *')],
      maxDurationS: {},
    })
    expect(report.missed.map((m) => m.job)).toEqual(['membership-expiry'])
  })

  it('needs one row per slot: three daily slots and two runs is one missed', () => {
    const report = buildCronLedger({
      now: new Date('2026-11-15T23:59:00Z'),
      since: new Date('2026-11-15T00:00:00Z'),
      runs: [
        run('event-emails', '2026-11-15T15:01:00Z', { at: '2026-11-15T15:01:40Z', ok: true }),
        run('event-emails', '2026-11-15T19:03:00Z', { at: '2026-11-15T19:03:40Z', ok: true }),
      ],
      schedules: [daily('event-emails', '0 15 * * *'), daily('event-emails', '0 17 * * *'), daily('event-emails', '0 19 * * *')],
      maxDurationS: { 'event-emails': 60 },
    })
    expect(report.missed.map((m) => m.slot)).toEqual(['2026-11-15T17:00:00.000Z'])
  })

  describe('weekly-digest: two Friday schedules, one run', () => {
    // vercel.json fires it at 18:00 and 19:00 UTC; the route records a row only
    // for the call at Denver midday (18:xx in summer, 19:xx in winter).
    const digest = [daily('weekly-digest', '0 18 * * 5'), daily('weekly-digest', '0 19 * * 5')]
    const friday = (runs: CronRunRow[]) =>
      buildCronLedger({ now: new Date('2026-11-14T00:00:00Z'), since: new Date('2026-11-13T00:00:00Z'), runs, schedules: digest, maxDurationS: {} })

    it('one winter row at 19:02 meets the Friday', () => {
      expect(friday([run('weekly-digest', '2026-11-13T19:02:00Z', { at: '2026-11-13T19:02:30Z', ok: true })]).missed).toEqual([])
    })

    it('one summer row at 18:03 meets the Friday', () => {
      expect(friday([run('weekly-digest', '2026-11-13T18:03:00Z', { at: '2026-11-13T18:03:30Z', ok: true })]).missed).toEqual([])
    })

    it('a run late in the 19:00 hour still counts', () => {
      expect(friday([run('weekly-digest', '2026-11-13T19:58:00Z', { at: '2026-11-13T19:58:30Z', ok: true })]).missed).toEqual([])
    })

    it('no row is exactly one missed Friday, naming both schedules', () => {
      expect(friday([]).missed).toEqual([
        { job: 'weekly-digest', path: '/api/cron/weekly-digest', schedule: '0 18 * * 5 or 0 19 * * 5', slot: '2026-11-13T18:00:00.000Z' },
      ])
    })

    it('waits for the 19:00 window to close before calling the Friday missed', () => {
      const report = buildCronLedger({ now: new Date('2026-11-13T19:30:00Z'), since: new Date('2026-11-13T00:00:00Z'), runs: [], schedules: digest, maxDurationS: {} })
      expect(report.missed).toEqual([])
    })

    it('every alternate job really has more than one schedule in vercel.json', () => {
      const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }
      for (const job of ALTERNATE_SCHEDULE_JOBS) {
        expect(vercel.crons.filter((c) => jobOfPath(c.path) === job).length, job).toBeGreaterThan(1)
      }
    })
  })

  it('a per-tenant child row never stands in for the platform calling the route', () => {
    const report = buildCronLedger({
      now: NOW,
      since: new Date('2026-11-15T00:00:00Z'),
      runs: [run('surveys', '2026-11-15T07:02:00Z', { at: '2026-11-15T07:02:30Z', ok: true }, { parent_id: PARENT, tenant_id: TENANT_B })],
      schedules: [daily('surveys', '0 7 * * *')],
      maxDurationS: {},
    })
    expect(report.missed.map((m) => m.job)).toEqual(['surveys'])
  })
})

describe('failed runs', () => {
  it('reports a finished run that is not ok, with its first distinct failures', () => {
    const errors = [
      { where: 'grant', message: 'insert failed' },
      { where: 'grant', message: 'insert failed' },
      { where: 'expire', message: 'timeout' },
    ]
    const report = buildCronLedger({
      now: NOW,
      since: SINCE,
      runs: [
        run('entitlements', '2026-11-15T05:01:00Z', { at: '2026-11-15T05:02:00Z', ok: false, errors }),
        run('entitlements', '2026-11-14T05:01:00Z', { at: '2026-11-14T05:02:00Z', ok: true }),
        // ok never written: not a clean run either.
        { ...run('campaigns', '2026-11-15T09:00:00Z', { at: '2026-11-15T09:00:30Z', ok: true }), ok: null },
        // An errors column of the wrong shape (older rows) does not break the report.
        run('alumni-upgrades', '2026-11-15T08:00:00Z', { at: '2026-11-15T08:01:00Z', ok: false, errors: 'boom' }),
      ],
      schedules: [],
      maxDurationS: {},
    })
    expect(report.failed.map((f) => f.job)).toEqual(['entitlements', 'alumni-upgrades', 'campaigns'])
    expect(report.failed[0].failures).toEqual([
      { where: 'grant', message: 'insert failed' },
      { where: 'expire', message: 'timeout' },
    ])
    expect(report.failed[1].failures).toEqual([])
    // The printout names the failure's label, never its message (it can carry data).
    const text = formatCronLedger(report)
    expect(text).toContain('grant')
    expect(text).not.toContain('insert failed')
  })
})

describe('the script arguments', () => {
  it('refuses to run without an explicit --env', () => {
    expect(() => parseCronLedgerArgs([])).toThrow(/--env dev or --env prod/)
    expect(() => parseCronLedgerArgs(['--env', 'staging'])).toThrow(/--env dev or --env prod/)
    expect(() => parseCronLedgerArgs(['--env'])).toThrow(/needs a value/)
    expect(() => parseCronLedgerArgs(['--env', 'dev', '--write'])).toThrow(/unknown argument/)
    expect(() => parseCronLedgerArgs(['--env', 'dev', '--hours', '0'])).toThrow(/--hours/)
  })

  it('reads --env, --hours and --json', () => {
    expect(parseCronLedgerArgs(['--env', 'dev'])).toEqual({ env: 'dev', hours: 48, json: false })
    expect(parseCronLedgerArgs(['--env=prod', '--hours=168', '--json'])).toEqual({ env: 'prod', hours: 168, json: true })
  })

  it('refuses a URL that is not the environment asked for, without echoing it', () => {
    const ref = 'prodrefplaceholder'
    const prodUrl = `postgres://reader:placeholder@db.${ref}.example.test:5432/postgres`
    const devUrl = 'postgres://reader:placeholder@db.devrefplaceholder.example.test:5432/postgres'
    expect(() => assertLedgerTarget('dev', undefined, ref)).toThrow(/not set/)
    expect(() => assertLedgerTarget('dev', prodUrl, ref)).toThrow(/names the production project/)
    expect(() => assertLedgerTarget('prod', devUrl, ref)).toThrow(/does not name the production project/)
    try {
      assertLedgerTarget('dev', prodUrl, ref)
    } catch (err) {
      expect((err as Error).message).not.toContain('placeholder@')
    }
    expect(assertLedgerTarget('dev', devUrl, ref)).toBe(devUrl)
    expect(assertLedgerTarget('prod', prodUrl, ref)).toBe(prodUrl)
  })

  it('the script only reads: select() on cron_runs and nothing else', () => {
    const src = readFileSync('scripts/cron-ledger.ts', 'utf8')
    expect(src).toMatch(/parseCronLedgerArgs\(process\.argv/)
    expect(src).toMatch(/assertLedgerTarget\(/)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code.match(/\.from\('([a-z_]+)'\)/g)).toEqual([".from('cron_runs')"])
    expect(code).toMatch(/\.select\('\*'\)/)
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc|storage|auth)\b/)
    // Its own variables only: never .env.local's service key or URL.
    expect(code).not.toMatch(/dotenv|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL/)
    expect(code).not.toMatch(/from 'postgres'/)
  })
})
