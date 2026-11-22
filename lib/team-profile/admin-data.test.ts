// @vitest-environment node
//
// The 'team-profiles' area (S5 A10c) on its three paths, through the real lib/tenancy/area-switch
// and lib/tenancy/db with a driver that answers as Postgres does for the pin, as
// lib/events/admin-config.test.ts does for 'events-config'. The supabase-js client is a recording
// stand-in: "service keeps today's queries" is a claim about the queries.
// test/integration/two-tenant/team-profiles.int.test.ts runs the same functions on a real
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
import { AssignError, loadCompanyPlan } from './assign'
import { CLEARED_OVERRIDE } from './override'
import {
  autoAssignEvent,
  comparablePlan,
  loadTeamProfilePlan,
  overrideOutstandingEvent,
  overrideParticipant,
  teamProfilesOnTenantPath,
} from './admin-data'

const SLUG = 'nevada-sdc'
const DATE = '2026-12-05'
const TENANT = 'c0ffee00-0000-4000-8000-0000000000b2'
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const R1 = '44444444-4444-4444-8444-444444444444'
const P1 = '33333333-3333-4333-8333-333333333331'
const P2 = '33333333-3333-4333-8333-333333333332'
const P3 = '33333333-3333-4333-8333-333333333333'
const M1 = '55555555-5555-4555-8555-555555555551'
const actor = { userId: 'user_admin', name: 'Admin' }

// ── Data both paths read ────────────────────────────────────────────────────

const ANSWERS = { teammates: '' }
const participant = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  member_id: null,
  first_name: 'Student',
  last_name: id.slice(-1),
  event_role: 'participant',
  gender: null,
  date_of_birth: '2000-01-01',
  grade: '11',
  school_name: 'Reno High',
  ethnicity: [],
  company_id: null,
  company_locked: false,
  team_profile_overridden_at: null,
  team_profile_overridden_by_name: null,
  ...extra,
})
const COMPANIES = [
  { id: C1, number: 1, name: 'Apollo' },
  { id: C2, number: 2, name: null },
]
const REGS = [
  {
    id: R1,
    type: 'individual',
    created_at: '2026-11-01T00:00:00+00:00',
    participants: [
      participant(P1, { member_id: M1 }),
      participant(P2, { team_profile_overridden_at: '2026-11-02T00:00:00+00:00', team_profile_overridden_by_name: 'Admin' }),
      participant(P3, { company_id: C1, company_locked: true }),
      // Not a student: never in the plan.
      participant('66666666-6666-4666-8666-666666666666', { event_role: 'mentor' }),
    ],
  },
]
const PROFILES = [{ participant_id: P1, answers: ANSWERS, submitted_at: '2026-11-03T00:00:00+00:00', last_sent_at: null, send_count: 1, last_send_error: null }]

// ── The service-role client ─────────────────────────────────────────────────

interface Call {
  table: string
  op: string
  select?: string
  payload?: unknown
  filters: [string, string, unknown][]
}

function fakeSupabase(rows: Record<string, unknown[]> = {}, opts: { failOp?: string } = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const c: Call = { table, op: 'select', filters: [] }
      calls.push(c)
      const result = () =>
        c.op === 'select'
          ? { data: rows[table] ?? [], error: null }
          : { data: null, error: opts.failOp === `${table}.${c.op}` ? { code: 'XX000', message: 'down' } : null }
      const chain: Record<string, unknown> = {
        select: (s: string) => ((c.select = s), chain),
        order: () => chain,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      for (const kind of ['eq', 'neq', 'in', 'not']) {
        chain[kind] = (k: string, v: unknown, w?: unknown) => (c.filters.push([kind, k, w === undefined ? v : [v, w]]), chain)
      }
      chain.update = (payload: unknown) => {
        c.op = 'update'
        c.payload = payload
        return chain
      }
      return chain
    },
  }
  return { db: client as unknown as SupabaseClient, calls }
}

const SERVICE_ROWS = { event_companies: COMPANIES, registrations: REGS, team_profiles: PROFILES }

/** A service client that fails the test if anything reaches it. */
const noService = new Proxy({}, { get() { throw new Error('the service path ran in tenant mode') } }) as never

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
          if (readOnly && /^\s*(?:insert|update|delete)\b/i.test(text)) {
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

/**
 * The tenant reads' rows, as postgres.js hands them back: json text for the embedded
 * participants (a driver may not parse it), and no member-profile ethnicity anywhere.
 */
function tenantAnswers(text: string): unknown[] {
  if (/FROM public\.event_companies\s+WHERE event_slug/.test(text)) return COMPANIES
  if (/FROM public\.registrations r\s+WHERE r\.event_slug/.test(text)) {
    return REGS.map((r) => ({ ...r, participants: JSON.stringify(r.participants) }))
  }
  if (/FROM public\.team_profiles\s+WHERE event_slug/.test(text)) return PROFILES.map((p) => ({ ...p, answers: JSON.stringify(p.answers) }))
  return []
}

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
  it("with no flags, the plan is today's loadCompanyPlan, query for query, and no tenant transaction opens", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const viaArea = fakeSupabase(SERVICE_ROWS)
    const direct = fakeSupabase(SERVICE_ROWS)
    const plan = await loadTeamProfilePlan(viaArea.db, STELLR_TENANT_ID, SLUG, DATE)
    expect(plan).toEqual(await loadCompanyPlan(direct.db, SLUG, DATE))
    expect(viaArea.calls).toEqual(direct.calls)
    expect(viaArea.calls.map((c) => c.table)).toEqual([
      'event_companies',
      'registrations',
      'team_profiles',
      'participants',
      'member_ethnicities',
      'agreements',
    ])
    expect(plan.students.map((s) => [s.participantId, s.status])).toEqual([
      [P1, 'submitted'],
      [P2, 'not_sent'],
      [P3, 'not_sent'],
    ])
    expect(pg.transactions()).toBe(0)
    expect(afterResponse.tasks).toEqual([])
  })

  it('with the flag on but the area not listed, or listed with the flag off, still service, and nothing connects', async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    flags('events-config:tenant')
    await loadTeamProfilePlan(fakeSupabase(SERVICE_ROWS).db, STELLR_TENANT_ID, SLUG, DATE)
    vi.stubEnv(TENANT_DB_FLAG, '')
    vi.stubEnv(TENANT_DB_AREAS_ENV, 'team-profiles:tenant')
    await loadTeamProfilePlan(fakeSupabase(SERVICE_ROWS).db, STELLR_TENANT_ID, SLUG, DATE)
    expect(teamProfilesOnTenantPath()).toBe(false)
    expect(pg.transactions()).toBe(0)
  })

  it("Auto-Assign: today's participant updates by id, and nothing through tenantDb", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase(SERVICE_ROWS)
    const result = await autoAssignEvent(db, STELLR_TENANT_ID, SLUG, DATE)
    expect(result).toEqual({ assigned: 2, overridden: 1, pooled: 0, kept: 1 })
    const writes = calls.filter((c) => c.op === 'update')
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) {
      expect(w.table).toBe('participants')
      expect(w.payload).toMatchObject({ company_locked: false })
      expect(w.filters[0][0]).toBe('in')
    }
    expect(writes.flatMap((w) => w.filters[0][2] as string[]).sort()).toEqual([P1, P2])
    expect(pg.transactions()).toBe(0)
  })

  it('Auto-Assign with no companies is the AssignError the route answers as a 400', async () => {
    const { db } = fakeSupabase({ ...SERVICE_ROWS, event_companies: [] })
    await expect(autoAssignEvent(db, STELLR_TENANT_ID, SLUG, DATE)).rejects.toBeInstanceOf(AssignError)
  })

  it("override: today's update by participant id; a failed write is false", async () => {
    const { db, calls } = fakeSupabase()
    expect(await overrideParticipant(db, STELLR_TENANT_ID, SLUG, P1, CLEARED_OVERRIDE)).toBe(true)
    expect(calls).toEqual([{ table: 'participants', op: 'update', payload: CLEARED_OVERRIDE, filters: [['eq', 'id', P1]] }])
    expect(await overrideParticipant(fakeSupabase({}, { failOp: 'participants.update' }).db, STELLR_TENANT_ID, SLUG, P1, CLEARED_OVERRIDE)).toBe(false)
  })

  it("override_all: today's read and update", async () => {
    const { db, calls } = fakeSupabase({
      participants: [
        { id: P1, event_role: 'participant', team_profile_overridden_at: null, registrations: { event_slug: SLUG, status: 'confirmed' } },
        { id: P2, event_role: 'participant', team_profile_overridden_at: null, registrations: { event_slug: SLUG, status: 'withdrawn' } },
      ],
      team_profiles: [],
    })
    expect(await overrideOutstandingEvent(db, STELLR_TENANT_ID, SLUG, actor)).toEqual({ overridden: 1 })
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual(['participants.select', 'team_profiles.select', 'participants.update'])
    expect(calls[2].filters).toEqual([['in', 'id', [P1]]])
  })
})

describe('tenant: team-profiles:tenant', () => {
  it('the plan reads through one tenantDb transaction pinned to the caller’s tenant, with the slug bound, never the service client', async () => {
    flags('team-profiles:tenant')
    expect(teamProfilesOnTenantPath()).toBe(true)
    const pg = pgLikeDriver(tenantAnswers)
    setTenantDbDriver(pg.driver)
    const plan = await loadTeamProfilePlan(noService, TENANT, SLUG, DATE)
    expect(pg.transactions()).toBe(1)
    expect(pg.sent.every((s) => s.tenant === TENANT && !s.readOnly)).toBe(true)
    // Companies, registrations, team profiles, the member history, the agreements; never a member table.
    expect(pg.sent).toHaveLength(5)
    expect(pg.sent.slice(0, 3).map((s) => s.values)).toEqual([[SLUG], [SLUG], [SLUG]])
    expect(pg.sent.map((s) => s.text).join('\n')).not.toMatch(/member_ethnicities|ethnicity_options|public\.members\b/)
    expect(pg.sent[3].values).toEqual([[M1], SLUG])
    expect(pg.sent[4].values).toEqual([[P1, P2, P3]])

    const service = await loadCompanyPlan(fakeSupabase(SERVICE_ROWS).db, SLUG, DATE)
    expect(comparablePlan(plan)).toEqual(comparablePlan(service))
    expect(plan.students.find((s) => s.participantId === P1)?.answers).not.toBeNull()
  })

  it('fails closed without a tenant: no read or write on either path', async () => {
    flags('team-profiles:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    await expect(loadTeamProfilePlan(noService, '', SLUG, DATE)).rejects.toThrow(/tenant id/)
    await expect(autoAssignEvent(noService, 'not-a-uuid', SLUG, DATE)).rejects.toThrow(/tenant id/)
    await expect(overrideOutstandingEvent(noService, '', SLUG, actor)).rejects.toThrow(/tenant id/)
    expect(pg.transactions()).toBe(0)
  })

  it('a read the database refuses is the request’s failure: no fallback to the service read', async () => {
    flags('team-profiles:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('permission denied'), { code: '42501' })
      }).driver,
    )
    await expect(loadTeamProfilePlan(noService, TENANT, SLUG, DATE)).rejects.toMatchObject({ code: '42501' })
  })

  it('Auto-Assign: the plan and every placement in one transaction, each UPDATE confined to the event and its company', async () => {
    flags('team-profiles:tenant')
    const pg = pgLikeDriver(tenantAnswers)
    setTenantDbDriver(pg.driver)
    expect(await autoAssignEvent(noService, TENANT, SLUG, DATE)).toEqual({ assigned: 2, overridden: 1, pooled: 0, kept: 1 })
    expect(pg.transactions()).toBe(1)
    const updates = pg.sent.filter((s) => /^\s*UPDATE public\.participants p/.test(s.text))
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) {
      expect(u.tenant).toBe(TENANT)
      expect(u.text).toMatch(/p\.id = ANY\(\$2::uuid\[\]\)/)
      expect(u.text).toMatch(/r\.event_slug = \$3/)
      expect(u.text).toMatch(/c\.event_slug = \$\d+/)
      expect(u.values[2]).toBe(SLUG)
    }
    expect(updates.flatMap((u) => u.values[1] as string[]).sort()).toEqual([P1, P2])
  })

  it('Auto-Assign with no companies is the same AssignError, and writes nothing', async () => {
    flags('team-profiles:tenant')
    const pg = pgLikeDriver((text) => (/FROM public\.event_companies/.test(text) ? [] : tenantAnswers(text)))
    setTenantDbDriver(pg.driver)
    await expect(autoAssignEvent(noService, TENANT, SLUG, DATE)).rejects.toBeInstanceOf(AssignError)
    expect(pg.sent.some((s) => /^\s*UPDATE/.test(s.text))).toBe(false)
  })

  it('override: one bound UPDATE confined to the event; a refusal is false', async () => {
    flags('team-profiles:tenant')
    const pg = pgLikeDriver(() => [{ id: P1 }])
    setTenantDbDriver(pg.driver)
    const fields = { team_profile_overridden_at: '2026-11-22T00:00:00.000Z', team_profile_overridden_by: 'user_admin', team_profile_overridden_by_name: 'Admin' }
    expect(await overrideParticipant(noService, TENANT, SLUG, P1, fields)).toBe(true)
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0].text).toMatch(/UPDATE public\.participants p/)
    expect(pg.sent[0].text).toMatch(/r\.event_slug = \$5/)
    expect(pg.sent[0].values).toEqual(['2026-11-22T00:00:00.000Z', 'user_admin', 'Admin', P1, SLUG])
    expect(pg.sent[0].tenant).toBe(TENANT)

    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('x'), { code: '42501' })
      }).driver,
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await overrideParticipant(noService, TENANT, SLUG, P1, CLEARED_OVERRIDE)).toBe(false)
    expect(error.mock.calls.flat().join(' ')).toContain('42501')
    error.mockRestore()
  })

  it('override_all: one bound UPDATE over this event’s outstanding students', async () => {
    flags('team-profiles:tenant')
    const pg = pgLikeDriver(() => [{ id: P1 }, { id: P2 }])
    setTenantDbDriver(pg.driver)
    expect(await overrideOutstandingEvent(noService, TENANT, SLUG, actor)).toEqual({ overridden: 2 })
    expect(pg.sent).toHaveLength(1)
    const [stmt] = pg.sent
    expect(stmt.text).toMatch(/r\.event_slug = \$4/)
    expect(stmt.text).toMatch(/r\.status IS DISTINCT FROM 'withdrawn'/)
    expect(stmt.text).toMatch(/p\.team_profile_overridden_at IS NULL/)
    expect(stmt.text).toMatch(/t\.submitted_at IS NOT NULL/)
    expect(stmt.values.slice(1)).toEqual(['user_admin', 'Admin', SLUG, ['participant', 'school_student_manager'], SLUG])
  })
})

describe('shadow: team-profiles:shadow', () => {
  it('the service read answers; the tenant read runs after the response, read-only, and the paths match despite the ethnicity fallback', async () => {
    flags('team-profiles:shadow')
    expect(teamProfilesOnTenantPath()).toBe(false)
    const pg = pgLikeDriver(tenantAnswers)
    setTenantDbDriver(pg.driver)
    // The service path finds an ethnicity on P1's member profile and a past event; the tenant path cannot.
    const rows = {
      ...SERVICE_ROWS,
      member_ethnicities: [{ member_id: M1, ethnicity_options: { name: 'Hispanic or Latino' } }],
      participants: [{ member_id: M1, registrations: { event_slug: 'texas-sdc', created_at: '2025-01-01T00:00:00+00:00' } }],
    }
    const { db } = fakeSupabase(rows)
    const plan = await loadTeamProfilePlan(db, STELLR_TENANT_ID, SLUG, DATE)
    const p1 = plan.students.find((s) => s.participantId === P1)
    expect(p1?.ethnicity).toEqual(['Hispanic or Latino'])
    expect(p1?.experience).toBe(1)
    expect(pg.transactions()).toBe(0)
    await afterResponse.flush()
    expect(pg.sent).toHaveLength(5)
    expect(pg.sent.every((s) => s.readOnly && s.tenant === STELLR_TENANT_ID)).toBe(true)
    expect(appErrors.recordBuiltAppError).not.toHaveBeenCalled()
  })

  it('a real difference is recorded as content, by counts only, never a name', async () => {
    flags('team-profiles:shadow')
    // The tenant read sees P3 unplaced: a difference in a compared field.
    setTenantDbDriver(
      pgLikeDriver((text) => {
        const rows = tenantAnswers(text)
        if (!/FROM public\.registrations r\s+WHERE/.test(text)) return rows
        return REGS.map((r) => ({ ...r, participants: r.participants.map((p) => (p.id === P3 ? { ...p, company_id: null, company_locked: false } : p)) }))
      }).driver,
    )
    await loadTeamProfilePlan(fakeSupabase(SERVICE_ROWS).db, STELLR_TENANT_ID, SLUG, DATE)
    await afterResponse.flush()
    expect(appErrors.recordBuiltAppError).toHaveBeenCalledTimes(1)
    const [route, message] = appErrors.recordBuiltAppError.mock.calls[0] as [string, string]
    expect(route).toContain('GET /admin/competitions/[slug]')
    expect(message).toContain('area=team-profiles reason=content service=1 tenant=1')
    expect(message).not.toMatch(/Student|Reno|Apollo|Admin/)
  })

  it('writes take the service path alone: a change is never applied twice', async () => {
    flags('team-profiles:shadow')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase(SERVICE_ROWS)
    await autoAssignEvent(db, STELLR_TENANT_ID, SLUG, DATE)
    expect(await overrideParticipant(db, STELLR_TENANT_ID, SLUG, P1, CLEARED_OVERRIDE)).toBe(true)
    await overrideOutstandingEvent(db, STELLR_TENANT_ID, SLUG, actor)
    expect(calls.some((c) => c.op === 'update')).toBe(true)
    await afterResponse.flush()
    expect(pg.transactions()).toBe(0)
  })
})
