// @vitest-environment node
//
// The 'surveys' area (S5 A10c) on its three paths, through the real lib/tenancy/area-switch and
// lib/tenancy/db with a driver that answers as Postgres does for the pin. The supabase-js client
// is a recording stand-in: "service keeps today's query" is a claim about the query.
// test/integration/two-tenant/surveys.int.test.ts runs the same functions on a real database in
// CI's tenant-db job.
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
import {
  COMPLETION_SELECT,
  loadCompletionInvitations,
  loadDistributionForEvent,
  logSurveyView,
  setDistributionGateCertificate,
  surveyAdminDb,
  surveysOnTenantPath,
  tenantUpdateDistribution,
  type CompletionInvitation,
} from './admin-data'
import { closeEarly, pauseDistribution, type DistributionRow } from './distributions'

const SLUG = 'nevada-sdc'
const TENANT = 'c0ffee00-0000-4000-8000-0000000000b2'
const D1 = '11111111-1111-4111-8111-111111111111'
const I1 = '22222222-2222-4222-8222-222222222222'
const I2 = '33333333-3333-4333-8333-333333333333'

// ── The service-role client ─────────────────────────────────────────────────

interface Call {
  table: string
  op: string
  select?: string
  payload?: unknown
  filters: unknown[][]
}

function fakeSupabase(opts: { rows?: unknown[]; single?: unknown; error?: unknown } = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const c: Call = { table, op: 'select', filters: [] }
      calls.push(c)
      const many = () => ({ data: opts.error ? null : (opts.rows ?? []), error: opts.error ?? null })
      let one = false
      const chain: Record<string, unknown> = {
        select: (s: string) => ((c.select = s), chain),
        eq: (k: string, v: unknown) => (c.filters.push(['eq', k, v]), chain),
        in: (k: string, v: unknown) => (c.filters.push(['in', k, v]), chain),
        order: (k: string, o?: unknown) => (c.filters.push(['order', k, o]), chain),
        limit: (n: number) => (c.filters.push(['limit', n]), chain),
        maybeSingle: () => ((one = true), chain),
        insert: (p: unknown) => ((c.op = 'insert'), (c.payload = p), chain),
        update: (p: unknown) => ((c.op = 'update'), (c.payload = p), chain),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(one ? { data: opts.error ? null : (opts.single ?? null), error: opts.error ?? null } : many()).then(resolve),
      }
      return chain
    },
  }
  return { db: client as unknown as SupabaseClient, calls }
}

// ── The tenant driver ───────────────────────────────────────────────────────

/** Behaves as Postgres does for the pin and READ ONLY; `answer` gives the caller statements' rows or throws. */
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

const DIST = {
  id: D1,
  definition_id: 'd0000000-0000-4000-8000-000000000001',
  event_slug: SLUG,
  event_date: '2026-11-06',
  event_time_zone: 'UTC',
  status: 'scheduled',
  opens_at: '2026-11-06T00:00:00+00:00',
  audiences: ['student', 'mentor', 'adult'],
  tenant_id: TENANT,
} as unknown as DistributionRow

const inv = (id: string, over: Partial<CompletionInvitation> = {}): CompletionInvitation => ({
  id,
  member_id: null,
  first_name: 'Ada',
  respondent_role: 'student',
  adult_relationship: null,
  email: 'ada@example.test',
  send_via: 'self',
  status: 'sent',
  sent_at: '2026-11-07T00:00:00+00:00',
  first_opened_at: null,
  opened_from: null,
  last_activity_at: null,
  reminder_count: 0,
  resume_reminder_count: 0,
  reminders_opted_out_at: null,
  last_send_error: null,
  participants: { first_name: 'Ada', last_name: 'L', member_id: null },
  members: null,
  survey_responses: { started_at: null, submitted_at: null },
  ...over,
})

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

describe('service: the default', () => {
  it("with no flags, the distribution read is today's query and no tenant transaction opens", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ single: { ...DIST, survey_definitions: { key: 'post_event' } } })
    expect(await loadDistributionForEvent(db, STELLR_TENANT_ID, SLUG)).toEqual(DIST)
    expect(calls).toEqual([
      {
        table: 'survey_distributions',
        op: 'select',
        select: '*, survey_definitions!inner(key)',
        filters: [
          ['eq', 'event_slug', SLUG],
          ['eq', 'survey_definitions.key', 'post_event'],
          ['order', 'created_at', { ascending: false }],
          ['limit', 1],
        ],
      },
    ])
    expect(pg.transactions()).toBe(0)
    expect(afterResponse.tasks).toEqual([])
    expect(surveysOnTenantPath()).toBe(false)
  })

  it("the completion read is today's select, and its error throws today's message", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: [inv(I1)] })
    expect(await loadCompletionInvitations(db, STELLR_TENANT_ID, D1)).toEqual([inv(I1)])
    expect(calls).toEqual([{ table: 'survey_invitations', op: 'select', select: COMPLETION_SELECT, filters: [['eq', 'distribution_id', D1]] }])
    await expect(loadCompletionInvitations(fakeSupabase({ error: { message: 'down' } }).db, STELLR_TENANT_ID, D1)).rejects.toThrow(
      'Reading invitations failed: down',
    )
    expect(pg.transactions()).toBe(0)
  })

  it("the access-log row is today's insert", async () => {
    const { db, calls } = fakeSupabase()
    await logSurveyView(db, STELLR_TENANT_ID, { actor: 'user_1', eventSlug: SLUG, distributionId: D1, rowCount: 3 })
    expect(calls).toEqual([
      {
        table: 'survey_access_log',
        op: 'insert',
        payload: {
          tenant_id: STELLR_TENANT_ID,
          actor: 'user_1',
          action: 'view',
          event_slug: SLUG,
          distribution_id: D1,
          response_id: null,
          row_count: 3,
          detail: { what: 'completion_table' },
        },
        filters: [],
      },
    ])
  })

  it("an admin action writes today's update, by id and status, then the audit row", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: [{ ...DIST, status: 'paused' }] })
    const r = await pauseDistribution(surveyAdminDb(db, STELLR_TENANT_ID), DIST, { memberId: null, label: 'user_1' }, new Date('2026-11-01T00:00:00Z'))
    expect(r.ok).toBe(true)
    expect(calls[0]).toEqual({
      table: 'survey_distributions',
      op: 'update',
      select: '*',
      payload: { status: 'paused', paused_at: '2026-11-01T00:00:00.000Z' },
      filters: [
        ['eq', 'id', D1],
        ['in', 'status', ['scheduled']],
      ],
    })
    expect(calls[1].table).toBe('audit_log')
    expect(pg.transactions()).toBe(0)
  })

  it('the same action with a bare client writes the same update (every other caller)', async () => {
    const a = fakeSupabase({ rows: [DIST] })
    const b = fakeSupabase({ rows: [DIST] })
    const now = new Date('2026-11-01T00:00:00Z')
    await closeEarly(a.db, DIST, { memberId: null, label: 'u' }, now)
    await closeEarly(surveyAdminDb(b.db, STELLR_TENANT_ID), DIST, { memberId: null, label: 'u' }, now)
    expect(b.calls).toEqual(a.calls)
  })

  it('the certificate gate runs the route’s own write', async () => {
    const write = vi.fn(async () => ({ error: null }))
    await setDistributionGateCertificate(write, STELLR_TENANT_ID, D1, true)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('with the flag on but the area not listed, or the area listed with the flag off, still service', async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    flags('events-config:tenant')
    await loadCompletionInvitations(fakeSupabase().db, STELLR_TENANT_ID, D1)
    expect(surveysOnTenantPath()).toBe(false)
    vi.stubEnv(TENANT_DB_FLAG, '')
    vi.stubEnv(TENANT_DB_AREAS_ENV, 'surveys:tenant')
    await loadCompletionInvitations(fakeSupabase().db, STELLR_TENANT_ID, D1)
    expect(surveysOnTenantPath()).toBe(false)
    expect(pg.transactions()).toBe(0)
  })
})

describe('tenant: surveys:tenant', () => {
  it('reads the distribution through tenantDb pinned to the caller’s tenant, slug bound, service never called', async () => {
    flags('surveys:tenant')
    // A driver that hands jsonb back as text still reads the same.
    const pg = pgLikeDriver((text) => (/FROM public\.survey_distributions d/.test(text) ? [{ row: JSON.stringify(DIST) }] : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    expect(surveysOnTenantPath()).toBe(true)
    expect(await loadDistributionForEvent(db, TENANT, SLUG)).toEqual(DIST)
    expect(calls).toEqual([])
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ values: [SLUG], tenant: TENANT, readOnly: false })
    expect(pg.sent[0].text).toMatch(/WHERE d\.event_slug = \$1\s+ORDER BY d\.created_at DESC\s+LIMIT 1/)
  })

  it('no distribution reads as null', async () => {
    flags('surveys:tenant')
    setTenantDbDriver(pgLikeDriver().driver)
    expect(await loadDistributionForEvent(fakeSupabase().db, TENANT, SLUG)).toBeNull()
  })

  it('reads the completion table with the distribution bound, and no members join', async () => {
    flags('surveys:tenant')
    const pg = pgLikeDriver((text) => (/FROM public\.survey_invitations i/.test(text) ? [{ row: inv(I1) }, { row: JSON.stringify(inv(I2)) }] : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    expect(await loadCompletionInvitations(db, TENANT, D1)).toEqual([inv(I1), inv(I2)])
    expect(calls).toEqual([])
    expect(pg.sent[0]).toMatchObject({ values: [D1], tenant: TENANT })
    expect(pg.sent[0].text).not.toMatch(/public\.members/)
  })

  it('an admin action writes through tenantDb: the patch bound as one jsonb, the status list bound, and the audit row on the service client', async () => {
    flags('surveys:tenant')
    const pg = pgLikeDriver((text) => (/UPDATE public\.survey_distributions d/.test(text) ? [{ row: { ...DIST, status: 'paused' } }] : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    const r = await pauseDistribution(surveyAdminDb(db, TENANT), DIST, { memberId: null, label: 'user_t' }, new Date('2026-11-01T00:00:00Z'))
    expect(r).toMatchObject({ ok: true, distribution: { status: 'paused' } })
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0].tenant).toBe(TENANT)
    expect(pg.sent[0].values).toContain(JSON.stringify({ status: 'paused', paused_at: '2026-11-01T00:00:00.000Z' }))
    expect(pg.sent[0].values).toContain(D1)
    expect(pg.sent[0].values).toContain('scheduled')
    expect(calls.map((c) => c.table)).toEqual(['audit_log'])
  })

  it('a write that matches nothing (another tenant’s row) answers the 409, not a write', async () => {
    flags('surveys:tenant')
    setTenantDbDriver(pgLikeDriver(() => []).driver)
    const { db, calls } = fakeSupabase()
    const r = await closeEarly(surveyAdminDb(db, TENANT), DIST, { memberId: null, label: 'u' })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(calls).toEqual([])
  })

  it('a refused write answers a fixed message, never the database’s', async () => {
    flags('surveys:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('new row violates policy for tenant c0ffee00 email ada@example.test'), { code: '42501' })
      }).driver,
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await closeEarly(surveyAdminDb(fakeSupabase().db, TENANT), DIST, { memberId: null, label: 'u' })
    expect(r).toEqual({ ok: false, status: 500, error: 'The survey could not be saved. Try again.' })
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/ada@|c0ffee00/)
    error.mockRestore()
  })

  it('refuses a patch column outside the admin set before anything is sent', async () => {
    const pg = pgLikeDriver()
    flags('surveys:tenant')
    setTenantDbDriver(pg.driver)
    const { tenantDb } = await import('@/lib/tenancy/db')
    await expect(tenantUpdateDistribution(tenantDb(TENANT), D1, { tenant_id: STELLR_TENANT_ID })).rejects.toThrow(/unsupported columns/)
    await expect(tenantUpdateDistribution(tenantDb(TENANT), D1, {})).rejects.toThrow(/unsupported columns/)
    expect(pg.sent).toEqual([])
  })

  it('the certificate gate and the access-log row go through tenantDb, and the route’s service write never runs', async () => {
    flags('surveys:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const write = vi.fn(async () => ({ error: null }))
    await setDistributionGateCertificate(write, TENANT, D1, true)
    const { db, calls } = fakeSupabase()
    await logSurveyView(db, TENANT, { actor: 'user_t', eventSlug: SLUG, distributionId: D1, rowCount: 2 })
    expect(write).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(pg.sent).toHaveLength(2)
    expect(pg.sent[0].values).toContain(JSON.stringify({ gate_certificate: true }))
    expect(pg.sent[1].text).toMatch(/INSERT INTO public\.survey_access_log/)
    expect(pg.sent[1].values).toEqual([TENANT, 'user_t', SLUG, D1, 2, JSON.stringify({ what: 'completion_table' })])
  })

  it('a failed access-log write is logged by its code and does not fail the request, as today', async () => {
    flags('surveys:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('denied'), { code: '42501' })
      }).driver,
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(logSurveyView(fakeSupabase().db, TENANT, { actor: 'u', eventSlug: SLUG, distributionId: null, rowCount: 1 })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('[survey] survey_access_log write failed:', '42501')
    error.mockRestore()
  })

  it('fails closed without a tenant: no read or write on either path', async () => {
    flags('surveys:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    await expect(loadDistributionForEvent(db, '', SLUG)).rejects.toThrow(/tenant id/)
    await expect(loadCompletionInvitations(db, 'not-a-uuid', D1)).rejects.toThrow(/tenant id/)
    await expect(surveyAdminDb(db, '').updateDistribution(D1, { status: 'closed' })).rejects.toThrow(/tenant id/)
    expect(calls).toEqual([])
    expect(pg.transactions()).toBe(0)
  })

  it('a read the database refuses is the request’s failure: no fallback to the service read', async () => {
    flags('surveys:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('permission denied'), { code: '42501' })
      }).driver,
    )
    const { db, calls } = fakeSupabase({ rows: [inv(I1)] })
    await expect(loadCompletionInvitations(db, TENANT, D1)).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

describe('shadow: surveys:shadow', () => {
  it('the service read answers; the tenant read runs after, read-only, and a row differing only by its members embed matches', async () => {
    flags('surveys:shadow')
    const serviceRows = [inv(I1, { participants: null, members: { first_name: 'Ada', last_name: 'Member' } })]
    const pg = pgLikeDriver(() => [{ row: inv(I1, { participants: null, members: null }) }])
    setTenantDbDriver(pg.driver)
    const { db } = fakeSupabase({ rows: serviceRows })
    expect(await loadCompletionInvitations(db, TENANT, D1)).toEqual(serviceRows)
    expect(pg.transactions()).toBe(0)
    await afterResponse.flush()
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0].readOnly).toBe(true)
    expect(appErrors.recordBuiltAppError).not.toHaveBeenCalled()
  })

  it('a difference is recorded by uuid and count only, never an email or a name', async () => {
    flags('surveys:shadow')
    setTenantDbDriver(pgLikeDriver(() => [{ row: inv(I2) }]).driver)
    await loadCompletionInvitations(fakeSupabase({ rows: [inv(I1)] }).db, TENANT, D1)
    await afterResponse.flush()
    expect(appErrors.recordBuiltAppError).toHaveBeenCalledTimes(1)
    const message = String(appErrors.recordBuiltAppError.mock.calls[0][1])
    expect(message).toContain('area=surveys reason=ids')
    expect(message).toContain(I1)
    expect(message).not.toMatch(/ada@example|Ada/)
  })

  it('writes take the service path alone', async () => {
    flags('surveys:shadow')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: [DIST] })
    await closeEarly(surveyAdminDb(db, TENANT), DIST, { memberId: null, label: 'u' })
    expect(calls.map((c) => [c.table, c.op])).toEqual([
      ['survey_distributions', 'update'],
      ['audit_log', 'insert'],
    ])
    expect(pg.transactions()).toBe(0)
  })
})
