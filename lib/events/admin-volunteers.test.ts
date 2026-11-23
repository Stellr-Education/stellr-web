// @vitest-environment node
//
// The 'volunteers' area (S5 A10c) on its three paths, through the real lib/tenancy/area-switch
// and lib/tenancy/db with a driver that answers as Postgres does for the pin. The supabase-js
// client is a recording stand-in: "service keeps today's query" is a claim about the query.
// test/integration/two-tenant/volunteers.int.test.ts runs the same functions on a real
// database in CI's tenant-db job.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appErrors = vi.hoisted(() => ({ recordBuiltAppError: vi.fn(async (..._a: unknown[]) => true) }))
vi.mock('@/lib/app-errors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordBuiltAppError: appErrors.recordBuiltAppError,
}))
const afterResponse = vi.hoisted(() => ({
  tasks: [] as (() => Promise<unknown>)[],
  async flush() {
    for (const t of this.tasks.splice(0)) await t()
  },
}))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    afterResponse.tasks.push(task)
  },
}))

import type { SupabaseClient } from '@supabase/supabase-js'
import { resetAreaSwitchState, TENANT_DB_AREAS_ENV } from '@/lib/tenancy/area-switch'
import { READ_ONLY_CHECK_SQL, READ_ONLY_SQL, setTenantDbDriver, TENANT_DB_FLAG, type TenantSqlDriver } from '@/lib/tenancy/db'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { withVolunteerMembers, type StellrOnlyDb } from './admin-records'
import { loadEventVolunteerInterest, VOLUNTEER_MEMBER } from './admin-volunteers'

const SLUG = 'nevada-sdc'
const TENANT = 'c0ffee00-0000-4000-8000-0000000000b2'
const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'

// ── The service-role client ─────────────────────────────────────────────────

interface Call {
  table: string
  select?: string
  filters: [string, string, unknown][]
  order?: [string, unknown]
}

function fakeSupabase(rowsByTable: Record<string, unknown[]> = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const c: Call = { table, filters: [] }
      calls.push(c)
      const chain: Record<string, unknown> = {
        select: (s: string) => ((c.select = s), chain),
        eq: (k: string, v: unknown) => (c.filters.push(['eq', k, v]), chain),
        in: (k: string, v: unknown) => (c.filters.push(['in', k, v]), chain),
        order: (k: string, o: unknown) => ((c.order = [k, o]), chain),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(resolve),
      }
      return chain
    },
  }
  return { db: client as unknown as SupabaseClient, calls }
}

// ── The tenant driver ───────────────────────────────────────────────────────

function pgLikeDriver(answer: (text: string, values: readonly unknown[]) => unknown[] = () => []) {
  const sent: { text: string; values: readonly unknown[]; tenant: unknown; readOnly: boolean }[] = []
  let transactions = 0
  const driver: TenantSqlDriver = {
    async transaction(fn) {
      transactions++
      let tenant: unknown = null
      let readOnly = false
      return fn({
        async query(text, values = []) {
          if (text === READ_ONLY_SQL) {
            readOnly = true
            return { rows: [], rowCount: 0 }
          }
          if (text === READ_ONLY_CHECK_SQL) return { rows: [{ read_only: readOnly ? 'on' : 'off' } as never], rowCount: 1 }
          if (text.includes('set_config')) {
            tenant = values[0]
            return { rows: [], rowCount: 0 }
          }
          if (text.startsWith('SET LOCAL ROLE')) return { rows: [], rowCount: 0 }
          if (text.includes('current_user AS role')) return { rows: [{ role: 'tenant_app', tenant } as never], rowCount: 1 }
          sent.push({ text, values, tenant, readOnly })
          const rows = answer(text, values)
          return { rows: rows as never[], rowCount: rows.length }
        },
      })
    },
  }
  return { driver, sent, transactions: () => transactions }
}

const ALICE = { id: M1, first_name: 'Alice', last_name: 'Ng', email: 'alice@example.invalid', date_of_birth: null }
const BOB = { id: M2, first_name: 'Bob', last_name: 'Ray', email: 'bob@example.invalid', date_of_birth: null }
const SERVICE_ROWS = [
  { member_id: M1, created_at: '2026-11-01T10:00:00+00:00', members: ALICE },
  { member_id: M2, created_at: '2026-11-02T10:00:00+00:00', members: BOB },
]
// postgres.js hands timestamptz back as a Date.
const TENANT_ROWS = [
  { member_id: M1, created_at: new Date('2026-11-01T10:00:00Z') },
  { member_id: M2, created_at: new Date('2026-11-02T10:00:00Z') },
]
const isInterestRead = (text: string) => /FROM public\.volunteer_event_interest/.test(text)

const flags = (areas?: string) => {
  vi.stubEnv(TENANT_DB_FLAG, 'true')
  if (areas !== undefined) vi.stubEnv(TENANT_DB_AREAS_ENV, areas)
}

beforeEach(() => {
  resetAreaSwitchState()
  setTenantDbDriver(null)
  appErrors.recordBuiltAppError.mockClear()
  afterResponse.tasks.length = 0
  vi.stubEnv(TENANT_DB_FLAG, '')
  vi.stubEnv(TENANT_DB_AREAS_ENV, '')
  vi.stubEnv('TENANT_DATABASE_URL', '')
})
afterEach(() => {
  setTenantDbDriver(null)
  vi.unstubAllEnvs()
})

const TODAYS_QUERY: Call = {
  table: 'volunteer_event_interest',
  select: `member_id, created_at, ${VOLUNTEER_MEMBER}`,
  filters: [
    ['eq', 'event_slug', SLUG],
    ['eq', 'status', 'interested'],
  ],
  order: ['created_at', { ascending: true }],
}

describe('service: the default', () => {
  it("with no flags, today's query (with its members embed) answers and no tenant transaction is opened", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ volunteer_event_interest: SERVICE_ROWS })
    expect(await loadEventVolunteerInterest(db, STELLR_TENANT_ID, SLUG)).toEqual(SERVICE_ROWS)
    expect(calls).toEqual([TODAYS_QUERY])
    expect(pg.transactions()).toBe(0)
    expect(afterResponse.tasks).toEqual([])
  })

  it('with the flag on but the area not listed, or the area listed but the flag off, still service', async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    flags('events-config:tenant')
    expect(await loadEventVolunteerInterest(fakeSupabase({ volunteer_event_interest: SERVICE_ROWS }).db, STELLR_TENANT_ID, SLUG)).toEqual(SERVICE_ROWS)
    vi.stubEnv(TENANT_DB_FLAG, '')
    vi.stubEnv(TENANT_DB_AREAS_ENV, 'volunteers:tenant')
    expect(await loadEventVolunteerInterest(fakeSupabase({ volunteer_event_interest: SERVICE_ROWS }).db, STELLR_TENANT_ID, SLUG)).toEqual(SERVICE_ROWS)
    expect(pg.transactions()).toBe(0)
  })

  it('a failed read answers as no rows, as today', async () => {
    const { db } = fakeSupabase({ volunteer_event_interest: null as never })
    expect(await loadEventVolunteerInterest(db, STELLR_TENANT_ID, SLUG)).toEqual([])
  })

  it('withVolunteerMembers reads nothing when every row carries the embed', async () => {
    const { db, calls } = fakeSupabase()
    expect(await withVolunteerMembers(db as StellrOnlyDb, SERVICE_ROWS)).toEqual(SERVICE_ROWS)
    expect(calls).toEqual([])
  })
})

describe('tenant: volunteers:tenant', () => {
  it('reads through tenantDb pinned to the caller’s tenant, with the slug bound, no members, and never the service client', async () => {
    flags('volunteers:tenant')
    const pg = pgLikeDriver((text) => (isInterestRead(text) ? TENANT_ROWS : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    expect(await loadEventVolunteerInterest(db, TENANT, SLUG)).toEqual([
      { member_id: M1, created_at: '2026-11-01T10:00:00.000Z' },
      { member_id: M2, created_at: '2026-11-02T10:00:00.000Z' },
    ])
    expect(calls).toEqual([])
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ values: [SLUG], tenant: TENANT, readOnly: false })
    expect(pg.sent[0].text).toMatch(/WHERE v\.event_slug = \$1 AND v\.status = 'interested'\s+ORDER BY v\.created_at ASC/)
    expect(pg.sent[0].text).not.toMatch(/members/)
  })

  it('fails closed without a tenant: no read on either path', async () => {
    flags('volunteers:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    await expect(loadEventVolunteerInterest(db, '', SLUG)).rejects.toThrow(/tenant id/)
    expect(calls).toEqual([])
    expect(pg.transactions()).toBe(0)
  })

  it('a read the database refuses is the request’s failure: no fallback to the service read', async () => {
    flags('volunteers:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('permission denied'), { code: '42501' })
      }).driver,
    )
    const { db, calls } = fakeSupabase({ volunteer_event_interest: SERVICE_ROWS })
    await expect(loadEventVolunteerInterest(db, TENANT, SLUG)).rejects.toMatchObject({ code: '42501' })
    expect(calls).toEqual([])
  })

  it("withVolunteerMembers fills the names from Stellr's client in one read by id", async () => {
    const { db, calls } = fakeSupabase({ members: [BOB, ALICE] })
    const rows = [
      { member_id: M1, created_at: 'a' },
      { member_id: M2, created_at: 'b' },
      { member_id: M1, created_at: 'c' },
    ]
    expect(await withVolunteerMembers(db as StellrOnlyDb, rows)).toEqual([
      { member_id: M1, created_at: 'a', members: ALICE },
      { member_id: M2, created_at: 'b', members: BOB },
      { member_id: M1, created_at: 'c', members: ALICE },
    ])
    expect(calls).toEqual([{ table: 'members', select: 'id, first_name, last_name, email, date_of_birth', filters: [['in', 'id', [M1, M2]]] }])
  })
})

describe('shadow: volunteers:shadow', () => {
  it('the service read answers; the tenantDb read runs after, read-only; the members embed is not a difference', async () => {
    flags('volunteers:shadow')
    const pg = pgLikeDriver((text) => (isInterestRead(text) ? TENANT_ROWS : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ volunteer_event_interest: SERVICE_ROWS })
    expect(await loadEventVolunteerInterest(db, STELLR_TENANT_ID, SLUG)).toEqual(SERVICE_ROWS)
    expect(calls).toEqual([TODAYS_QUERY])
    expect(pg.transactions()).toBe(0)
    await afterResponse.flush()
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ readOnly: true, tenant: STELLR_TENANT_ID })
    expect(appErrors.recordBuiltAppError).not.toHaveBeenCalled()
  })

  it('a difference is recorded by member uuid and count only, never a name or an email', async () => {
    flags('volunteers:shadow')
    setTenantDbDriver(pgLikeDriver((text) => (isInterestRead(text) ? [TENANT_ROWS[0]] : [])).driver)
    await loadEventVolunteerInterest(fakeSupabase({ volunteer_event_interest: SERVICE_ROWS }).db, STELLR_TENANT_ID, SLUG)
    await afterResponse.flush()
    expect(appErrors.recordBuiltAppError).toHaveBeenCalledTimes(1)
    const [route, message] = appErrors.recordBuiltAppError.mock.calls[0] as [string, string]
    expect(route).toContain('GET /api/admin/events/[slug]/volunteers')
    expect(message).toContain('area=volunteers reason=count service=2 tenant=1')
    expect(message).toContain(M2)
    expect(message).not.toMatch(/Bob|Ray|example\.invalid/)
  })

  it('a different timestamp is a content difference', async () => {
    flags('volunteers:shadow')
    setTenantDbDriver(
      pgLikeDriver((text) => (isInterestRead(text) ? [TENANT_ROWS[0], { member_id: M2, created_at: new Date('2026-11-03T10:00:00Z') }] : [])).driver,
    )
    await loadEventVolunteerInterest(fakeSupabase({ volunteer_event_interest: SERVICE_ROWS }).db, STELLR_TENANT_ID, SLUG)
    await afterResponse.flush()
    const [, message] = appErrors.recordBuiltAppError.mock.calls[0] as [string, string]
    expect(message).toContain('reason=content')
    expect(message).toContain(`differ=${M2}`)
  })
})
