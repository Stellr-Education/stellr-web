// @vitest-environment node
//
// The 'events-read' area (S5 wave 8, C8-PG callers) on its three paths, through the real
// lib/tenancy/area-switch and lib/tenancy/db, with a driver that answers as Postgres does
// for the pin and READ ONLY, and lib/events/repo (Sanity) stood in.
// test/integration/two-tenant/events-read.int.test.ts runs the tenantDb reads on a real
// database in CI's tenant-db job.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/app-errors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordBuiltAppError: vi.fn(async () => true),
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
const sanity = vi.hoisted(() => ({
  bySlug: vi.fn(async (slug: string) => ({ _id: 'sanity-1', title: 'From Sanity', slug: { current: slug }, description: 'Sanity only' })),
  bySlugs: vi.fn(async (slugs: string[]) => slugs.map((s) => ({ _id: `id-${s}`, title: 'From Sanity', slug: { current: s } }))),
  byIds: vi.fn(async (ids: string[]) => ids.map((i) => ({ _id: i, title: 'From Sanity', slug: { current: `slug-${i}` } }))),
}))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: sanity.bySlug, getEventsBySlugs: sanity.bySlugs, getEventsByIds: sanity.byIds }))

import { resetAreaSwitchState, TENANT_DB_AREAS_ENV } from '@/lib/tenancy/area-switch'
import { READ_ONLY_CHECK_SQL, READ_ONLY_SQL, setTenantDbDriver, TENANT_DB_FLAG, type TenantSqlDriver } from '@/lib/tenancy/db'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { getEventBySlugIn, getEventsByIdsIn, getEventsBySlugsIn } from './tenant-facade'

const CANARY = '00000000-0000-4000-8000-0000000ca4a2'
const SLUG = 'canary-expo'

const mirrorRow = (tenant: string, slug: string, sanityId = `sid-${slug}`) => ({
  tenant_id: tenant,
  slug,
  sanity_id: sanityId,
  title: `Mirror ${slug}`,
  activity_type: 'competition',
  starts_at: '2027-03-05T15:00:00+00:00',
  ends_at: '2027-03-06T22:00:00+00:00',
  time_zone: 'America/Denver',
  country: 'US',
  status: 'live',
  raw: { venue: 'Hall A', city: 'Denver', state: 'CO' },
})

/** Behaves as Postgres does for the pin and READ ONLY; `answer` gives the caller statements' rows. */
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

const flags = (areas: string) => {
  vi.stubEnv(TENANT_DB_FLAG, 'true')
  vi.stubEnv(TENANT_DB_AREAS_ENV, areas)
}

beforeEach(() => {
  resetAreaSwitchState()
  setTenantDbDriver(null)
  afterResponse.tasks.length = 0
  sanity.bySlug.mockClear()
  sanity.bySlugs.mockClear()
  sanity.byIds.mockClear()
  vi.stubEnv(TENANT_DB_FLAG, '')
  vi.stubEnv(TENANT_DB_AREAS_ENV, '')
  vi.stubEnv('TENANT_DATABASE_URL', '')
})
afterEach(() => {
  setTenantDbDriver(null)
  vi.unstubAllEnvs()
})

describe('service: the default', () => {
  it('answers with Sanity exactly as lib/events/repo does, and opens no tenant transaction', async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    expect(await getEventBySlugIn(STELLR_TENANT_ID, SLUG)).toEqual(await sanity.bySlug(SLUG))
    expect(await getEventsBySlugsIn(STELLR_TENANT_ID, ['a', 'b'])).toEqual(await sanity.bySlugs(['a', 'b']))
    expect(await getEventsByIdsIn(STELLR_TENANT_ID, ['x'])).toEqual(await sanity.byIds(['x']))
    expect(pg.transactions()).toBe(0)
    expect(afterResponse.tasks).toEqual([])
  })

  it('refuses a missing or malformed tenant before reading anything', () => {
    expect(() => getEventBySlugIn('', SLUG)).toThrow()
    expect(() => getEventsBySlugsIn('not-a-uuid', [SLUG])).toThrow()
    expect(() => getEventsByIdsIn(undefined as unknown as string, ['x'])).toThrow()
    expect(sanity.bySlug).not.toHaveBeenCalled()
  })
})

describe('tenant: the mirror answers, inside the tenant', () => {
  it('reads by slug as the tenant, maps the row, and never asks Sanity', async () => {
    flags('events-read:tenant')
    const pg = pgLikeDriver(() => [mirrorRow(CANARY, SLUG)])
    setTenantDbDriver(pg.driver)
    const e = await getEventBySlugIn(CANARY, SLUG)
    expect(e).toMatchObject({ _id: `sid-${SLUG}`, title: `Mirror ${SLUG}`, slug: { current: SLUG }, venue: 'Hall A', city: 'Denver', state: 'CO' })
    expect(sanity.bySlug).not.toHaveBeenCalled()
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ tenant: CANARY, values: [SLUG] })
    expect(pg.sent[0].text).toMatch(/FROM public\.events WHERE slug = \$1/)
  })

  it('drops a row of another tenant even if one came back', async () => {
    flags('events-read:tenant')
    setTenantDbDriver(pgLikeDriver(() => [mirrorRow(STELLR_TENANT_ID, SLUG)]).driver)
    expect(await getEventBySlugIn(CANARY, SLUG)).toBeNull()
  })

  it('lists by slugs and by Sanity ids within the tenant only', async () => {
    flags('events-read:tenant')
    const rows = [mirrorRow(CANARY, 'a', 'ia'), mirrorRow(STELLR_TENANT_ID, 'b', 'ib')]
    const pg = pgLikeDriver(() => rows)
    setTenantDbDriver(pg.driver)
    expect((await getEventsBySlugsIn(CANARY, ['a', 'b', 'a', ''])).map((e) => e.slug.current)).toEqual(['a'])
    expect(pg.sent[0].values).toEqual([['a', 'b']])
    expect((await getEventsByIdsIn(CANARY, ['ia', 'ib'])).map((e) => e._id)).toEqual(['ia'])
    expect(pg.sent[1].text).toMatch(/WHERE sanity_id = ANY/)
  })

  it('asks nothing for an empty list', async () => {
    flags('events-read:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    expect(await getEventsBySlugsIn(CANARY, [])).toEqual([])
    expect(pg.sent).toEqual([])
  })
})

describe('shadow: Sanity answers, the mirror is compared after', () => {
  it('returns Sanity’s answer and reads the mirror read-only after the response', async () => {
    flags('events-read:shadow')
    const pg = pgLikeDriver(() => [mirrorRow(STELLR_TENANT_ID, SLUG)])
    setTenantDbDriver(pg.driver)
    expect(await getEventBySlugIn(STELLR_TENANT_ID, SLUG)).toEqual(await sanity.bySlug(SLUG))
    expect(pg.sent).toEqual([])
    await afterResponse.flush()
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ tenant: STELLR_TENANT_ID, readOnly: true })
  })
})
