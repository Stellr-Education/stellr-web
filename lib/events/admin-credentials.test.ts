// @vitest-environment node
//
// The 'credentials' area (S5 A10c) on its three paths, through the real lib/tenancy/area-switch
// and lib/tenancy/db with a driver that answers as Postgres does for the pin. The supabase-js
// client is a recording stand-in: "service keeps today's query" is a claim about the query.
// test/integration/two-tenant/credentials.int.test.ts runs the same functions on a real
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
import { tenantWideScope } from '@/lib/tenancy/scope-context'
import { CREDENTIAL_COLUMNS } from '@/lib/credentials'
import type { StellrOnlyDb } from '@/lib/events/admin-records'
import {
  CredentialsReadError,
  credentialsOnTenantPath,
  listEventCredentials,
  loadTenantCredentialPanel,
  revokeEventCredential,
  tenantEventCredentials,
  tenantRevokeCredential,
} from './admin-credentials'

const SLUG = 'nevada-sdc'
const TENANT = 'c0ffee00-0000-4000-8000-0000000000b2'
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const ACTOR = '33333333-3333-4333-8333-333333333333'

const row = (id: string, name: string) => ({
  id,
  number: `STL-2026-${id.slice(0, 4)}`,
  source: 'event',
  event_slug: SLUG,
  recipient_name: name,
  award_type: 'participation',
  skills: ['Teamwork'],
  pd_hours: null,
  activity_date: null,
  issued_at: '2026-11-01T10:00:00.123456+00:00',
  status: 'issued',
})
const ROWS = [row(C1, 'Ada Tester'), row(C2, 'Ben Tester')]

// ── The service-role client ─────────────────────────────────────────────────

interface Call {
  table: string
  op: string
  select?: string
  payload?: unknown
  filters: [string, string, unknown][]
  order?: string
  single?: boolean
}

function fakeSupabase(opts: { rows?: unknown[]; error?: unknown } = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const c: Call = { table, op: 'select', filters: [] }
      calls.push(c)
      const result = () => {
        if (opts.error) return { data: null, error: opts.error }
        if (c.single) return { data: c.op === 'update' ? { ...(opts.rows?.[0] as object), status: 'revoked' } : null, error: null }
        return { data: opts.rows ?? [], error: null }
      }
      const chain: Record<string, unknown> = {
        select: (s: string) => ((c.select = c.select ?? s), chain),
        eq: (k: string, v: unknown) => (c.filters.push(['eq', k, v]), chain),
        neq: (k: string, v: unknown) => (c.filters.push(['neq', k, v]), chain),
        order: (k: string) => ((c.order = k), chain),
        update: (payload: unknown) => ((c.op = 'update'), (c.payload = payload), chain),
        maybeSingle: () => ((c.single = true), Promise.resolve(result())),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return chain
    },
  }
  return { db: client as unknown as SupabaseClient & StellrOnlyDb, calls }
}

// ── The tenant driver ───────────────────────────────────────────────────────

/** Behaves as Postgres does for the pin and READ ONLY; `answer` gives the caller statements' rows or throws. */
function pgLikeDriver(answer: (text: string, values: readonly unknown[]) => unknown[] = () => []) {
  const sent: { text: string; values: readonly unknown[]; tenant: unknown; readOnly: boolean; tx: number }[] = []
  let transactions = 0
  const driver: TenantSqlDriver = {
    async transaction(fn) {
      const tx = ++transactions
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
          sent.push({ text, values, tenant, readOnly, tx })
          if (readOnly && /^\s*(?:insert|update|delete|with\b[\s\S]*\bupdate\b)/i.test(text)) {
            throw Object.assign(new Error('read-only'), { code: '25006' })
          }
          const rows = answer(text, values)
          return { rows: rows as never[], rowCount: rows.length }
        },
      })
    },
  }
  return { driver, sent, transactions: () => transactions }
}

const isList = (text: string) => /FROM public\.credentials/.test(text) && /row_to_json\(c\)/.test(text)
/** The driver hands json back parsed, or as text: both read the same. */
const asJson = (rows: unknown[], text = false) => rows.map((r) => ({ row: text ? JSON.stringify(r) : r }))

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

/** The column list between SELECT/RETURNING and the next keyword, as CREDENTIAL_COLUMNS spells it. */
const columnsIn = (text: string, after: RegExp, before: RegExp) => {
  const start = text.search(after)
  const rest = text.slice(start).replace(after, '')
  return rest.slice(0, rest.search(before)).trim().replace(/\s+/g, ' ')
}

describe('the statements', () => {
  it("select and return exactly today's columns (CREDENTIAL_COLUMNS), in order", async () => {
    const pg = pgLikeDriver()
    const db = { sql: (s: TemplateStringsArray, ...v: unknown[]) => (pg.sent.push({ text: s.join('$?'), values: v, tenant: null, readOnly: false, tx: 0 }), Promise.resolve([])) }
    await tenantEventCredentials(db as never, SLUG, 'students')
    await tenantRevokeCredential(db as never, C1, 'r', null, '2026-11-22T00:00:00.000Z')
    expect(columnsIn(pg.sent[0].text, /SELECT id,/, /\s+FROM public\.credentials/)).toBe(CREDENTIAL_COLUMNS.replace(/^id, /, ''))
    expect(columnsIn(pg.sent[1].text, /RETURNING /, /\s+\)\s+SELECT/)).toBe(CREDENTIAL_COLUMNS)
  })

  it('join nothing: no members, no participants, in the list or the revoke', async () => {
    const pg = pgLikeDriver()
    const db = { sql: (s: TemplateStringsArray) => (pg.sent.push({ text: s.join('$?'), values: [], tenant: null, readOnly: false, tx: 0 }), Promise.resolve([])) }
    await tenantEventCredentials(db as never, SLUG, 'mentors')
    await tenantRevokeCredential(db as never, C1, 'r', null, 'now')
    for (const s of pg.sent) expect(s.text).not.toMatch(/members|JOIN/i)
  })
})

describe('service: the default', () => {
  it("with no flags, today's list query answers and no tenant transaction is opened", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: ROWS })
    expect(await listEventCredentials(db, STELLR_TENANT_ID, SLUG, 'students')).toEqual(ROWS)
    expect(calls).toEqual([
      {
        table: 'credentials',
        op: 'select',
        select: CREDENTIAL_COLUMNS,
        filters: [['eq', 'event_slug', SLUG], ['eq', 'source', 'event'], ['neq', 'award_type', 'mentor']],
        order: 'recipient_name',
      },
    ])
    expect(await listEventCredentials(db, STELLR_TENANT_ID, SLUG, 'mentors')).toEqual(ROWS)
    expect(calls[1].filters).toEqual([['eq', 'event_slug', SLUG], ['eq', 'source', 'event'], ['eq', 'award_type', 'mentor']])
    expect(pg.transactions()).toBe(0)
    expect(afterResponse.tasks).toEqual([])
  })

  it('with the flag on but the area not listed, or listed with the flag off, still service', async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    flags('events-config:tenant')
    expect(await listEventCredentials(fakeSupabase({ rows: ROWS }).db, STELLR_TENANT_ID, SLUG, 'students')).toEqual(ROWS)
    vi.stubEnv(TENANT_DB_FLAG, '')
    vi.stubEnv(TENANT_DB_AREAS_ENV, 'credentials:tenant')
    expect(await listEventCredentials(fakeSupabase({ rows: ROWS }).db, STELLR_TENANT_ID, SLUG, 'students')).toEqual(ROWS)
    expect(pg.transactions()).toBe(0)
  })

  it('a failed list read answers an empty list, as today', async () => {
    const { db } = fakeSupabase({ error: { code: 'XX000', message: 'down' } })
    expect(await listEventCredentials(db, STELLR_TENANT_ID, SLUG, 'students')).toEqual([])
  })

  it("revoke: today's update, by id while issued, returning today's columns", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: [ROWS[0]] })
    const out = await revokeEventCredential(db, STELLR_TENANT_ID, C1, 'Duplicate', ACTOR)
    expect(out).toMatchObject({ id: C1, status: 'revoked' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'credentials', op: 'update', select: CREDENTIAL_COLUMNS, single: true })
    expect(calls[0].filters).toEqual([['eq', 'id', C1], ['eq', 'status', 'issued']])
    expect(calls[0].payload).toMatchObject({ status: 'revoked', revoked_reason: 'Duplicate', revoked_by: ACTOR })
    expect(pg.transactions()).toBe(0)
  })

  it('the tenant panel never answers from the service path', async () => {
    flags('credentials:shadow')
    await expect(loadTenantCredentialPanel(TENANT, SLUG, 'students')).rejects.toBeInstanceOf(CredentialsReadError)
  })
})

describe('credentialsOnTenantPath', () => {
  it("is true only for another tenant's scope with the area on the tenant path", () => {
    const stellr = tenantWideScope(STELLR_TENANT_ID, 'tenant_admin')
    const other = tenantWideScope(TENANT, 'tenant_admin')
    expect(credentialsOnTenantPath(other)).toBe(false)
    flags('credentials:shadow')
    expect(credentialsOnTenantPath(other)).toBe(false)
    flags('credentials:tenant')
    expect(credentialsOnTenantPath(other)).toBe(true)
    expect(credentialsOnTenantPath(stellr)).toBe(false)
    vi.stubEnv(TENANT_DB_FLAG, 'false')
    expect(credentialsOnTenantPath(other)).toBe(false)
  })
})

describe('tenant: credentials:tenant', () => {
  it('lists through tenantDb pinned to the caller’s tenant, with the slug and audience bound, never the service client', async () => {
    flags('credentials:tenant')
    const pg = pgLikeDriver((text) => (isList(text) ? asJson(ROWS, true) : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: [] })
    expect(await listEventCredentials(db, TENANT, SLUG, 'mentors')).toEqual(ROWS)
    expect(calls).toEqual([])
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ values: [SLUG, true], tenant: TENANT, readOnly: false })
    expect(pg.sent[0].text).toMatch(/WHERE event_slug = \$1 AND source = 'event'/)
    expect(pg.sent[0].text).toMatch(/ORDER BY c\.recipient_name/)
  })

  it('fails closed without a tenant: no read on either path', async () => {
    flags('credentials:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    await expect(listEventCredentials(db, '', SLUG, 'students')).rejects.toThrow(/tenant id/)
    await expect(revokeEventCredential(db, 'not-a-uuid', C1, 'r', null)).rejects.toThrow(/tenant id/)
    await expect(loadTenantCredentialPanel('', SLUG, 'students')).rejects.toThrow(/tenant id/)
    expect(calls).toEqual([])
    expect(pg.transactions()).toBe(0)
  })

  it('a list the database refuses is the request’s failure: no fallback to the service read', async () => {
    flags('credentials:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('permission denied'), { code: '42501' })
      }).driver,
    )
    const { db, calls } = fakeSupabase({ rows: ROWS })
    await expect(listEventCredentials(db, TENANT, SLUG, 'students')).rejects.toMatchObject({ code: '42501' })
    expect(calls).toEqual([])
  })

  it('revoke: one bound UPDATE by id while issued, returning the row; nothing matched is null', async () => {
    flags('credentials:tenant')
    const pg = pgLikeDriver(() => asJson([{ ...ROWS[0], status: 'revoked' }]))
    setTenantDbDriver(pg.driver)
    const noService = new Proxy({}, { get() { throw new Error('the service path ran in tenant mode') } }) as never
    expect(await revokeEventCredential(noService, TENANT, C1, 'Duplicate', ACTOR)).toMatchObject({ id: C1, status: 'revoked' })
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0].tenant).toBe(TENANT)
    expect(pg.sent[0].text).toMatch(/UPDATE public\.credentials/)
    expect(pg.sent[0].text).toMatch(/WHERE id = \$\d+::uuid AND status = 'issued'/)
    const [now, reason, by, , id] = pg.sent[0].values as string[]
    expect([reason, by, id]).toEqual(['Duplicate', ACTOR, C1])
    expect(Number.isNaN(Date.parse(now))).toBe(false)

    setTenantDbDriver(pgLikeDriver(() => []).driver)
    expect(await revokeEventCredential(noService, TENANT, C1, 'again', null)).toBeNull()
  })

  it('revoke: a refusal reads as null, as a failed service update does, and the log names the code only', async () => {
    flags('credentials:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('new row violates row-level security policy for Ada'), { code: '42501' })
      }).driver,
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await revokeEventCredential(fakeSupabase().db, TENANT, C1, 'r', null)).toBeNull()
    expect(error.mock.calls.flat().join(' ')).toContain('42501')
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/row-level|Ada/)
    error.mockRestore()
  })

  it('the panel: one tenant transaction, the audience’s wording, the list and the checked-in count', async () => {
    flags('credentials:tenant')
    const settings = {
      credential_title: 'Participant',
      credential_description: null,
      credential_criteria: null,
      credential_skills: ['Teamwork'],
      mentor_credential_title: 'Mentor',
      mentor_credential_description: 'Thanks',
      mentor_credential_criteria: null,
      mentor_credential_skills: null,
    }
    const pg = pgLikeDriver((text) => {
      if (/FROM public\.event_settings/.test(text)) return [settings]
      if (isList(text)) return asJson(ROWS)
      if (/count\(\*\)/.test(text)) return [{ n: 3 }]
      return []
    })
    setTenantDbDriver(pg.driver)
    expect(await loadTenantCredentialPanel(TENANT, SLUG, 'mentors')).toEqual({
      settings: { credential_title: 'Mentor', credential_description: 'Thanks', credential_criteria: null, credential_skills: [] },
      credentials: ROWS,
      checkedInCount: 3,
    })
    expect(pg.transactions()).toBe(1)
    expect(pg.sent.map((s) => s.tenant)).toEqual([TENANT, TENANT, TENANT])
    expect(pg.sent.every((s) => s.values[0] === SLUG)).toBe(true)
    expect(pg.sent[2].text).toMatch(/r\.status <> 'withdrawn' AND p\.checked_in_at IS NOT NULL/)
    for (const s of pg.sent) expect(s.text).not.toMatch(/members|cohort/)

    // No settings row: null, as loadCredentialSettings answers; a count as text reads as a number.
    setTenantDbDriver(pgLikeDriver((text) => (/count\(\*\)/.test(text) ? [{ n: '0' }] : [])).driver)
    expect(await loadTenantCredentialPanel(TENANT, SLUG, 'students')).toEqual({ settings: null, credentials: [], checkedInCount: 0 })
  })
})

describe('shadow: credentials:shadow', () => {
  it('the service list answers; the tenantDb read runs after the response, read-only, and a match records nothing', async () => {
    flags('credentials:shadow')
    // The tenant path returns microseconds as PostgREST does; equal rows record nothing.
    const pg = pgLikeDriver((text) => (isList(text) ? asJson(ROWS) : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: ROWS })
    expect(await listEventCredentials(db, STELLR_TENANT_ID, SLUG, 'students')).toEqual(ROWS)
    expect(calls).toHaveLength(1)
    expect(pg.transactions()).toBe(0)
    await afterResponse.flush()
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ readOnly: true, tenant: STELLR_TENANT_ID })
    expect(appErrors.recordBuiltAppError).not.toHaveBeenCalled()
  })

  it('a difference is recorded by uuid and count only, never a name or a credential number', async () => {
    flags('credentials:shadow')
    setTenantDbDriver(pgLikeDriver((text) => (isList(text) ? asJson([ROWS[0]]) : [])).driver)
    await listEventCredentials(fakeSupabase({ rows: ROWS }).db, STELLR_TENANT_ID, SLUG, 'students')
    await afterResponse.flush()
    expect(appErrors.recordBuiltAppError).toHaveBeenCalledTimes(1)
    const [route, message] = appErrors.recordBuiltAppError.mock.calls[0] as [string, string]
    expect(route).toContain('GET /api/admin/events/[slug]/credentials')
    expect(message).toContain('area=credentials reason=count service=2 tenant=1')
    expect(message).toContain(C2)
    expect(message).not.toMatch(/Tester|STL-/)
  })

  it('revoke takes the service path alone: a change is never applied twice', async () => {
    flags('credentials:shadow')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: [ROWS[0]] })
    await revokeEventCredential(db, STELLR_TENANT_ID, C1, 'r', null)
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(['credentials.update'])
    await afterResponse.flush()
    expect(pg.transactions()).toBe(0)
  })
})
