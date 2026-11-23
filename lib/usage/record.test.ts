// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S6-USE: recordUsage is free with the flag off (no client, nothing scheduled),
// and on, a fire-and-forget insert of counts only that can never throw into the
// request.

const h = vi.hoisted(() => ({
  clients: 0,
  inserts: [] as { table: string; row: unknown }[],
  insertError: null as { message: string } | null,
  scheduled: [] as { label: string; task: () => Promise<unknown> }[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    h.clients++
    return {
      from: (table: string) => ({
        insert: async (row: unknown) => {
          h.inserts.push({ table, row })
          return { error: h.insertError }
        },
      }),
    }
  },
}))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (label: string, task: () => Promise<unknown>) => {
    h.scheduled.push({ label, task })
  },
}))

const { recordUsage, usageMeteringEnabled, USAGE_FLAG, USAGE_KINDS } = await import('./record')

const TENANT = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  h.clients = 0
  h.inserts = []
  h.insertError = null
  h.scheduled = []
})
afterEach(() => vi.unstubAllEnvs())

describe('usageMeteringEnabled', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['TRUE', false],
    [' true', false],
    ['1', false],
    ['true', true],
  ])('%s -> %s (exactly "true" turns it on)', (raw, want) => {
    vi.stubEnv(USAGE_FLAG, raw as string)
    expect(usageMeteringEnabled()).toBe(want)
  })
})

describe('recordUsage with the flag off', () => {
  it('creates no client and schedules nothing, for every kind', () => {
    for (const kind of USAGE_KINDS) recordUsage(TENANT, kind)
    expect(h.scheduled).toHaveLength(0)
    expect(h.clients).toBe(0)
  })
})

describe('recordUsage with the flag on', () => {
  beforeEach(() => vi.stubEnv(USAGE_FLAG, 'true'))

  it('writes nothing until after the response, then one row of counts only', async () => {
    recordUsage(TENANT, 'email', 3)
    expect(h.clients).toBe(0)
    expect(h.scheduled).toHaveLength(1)
    await h.scheduled[0].task()
    expect(h.inserts).toEqual([{ table: 'usage_events', row: { tenant_id: TENANT, kind: 'email', count: 3 } }])
  })

  it('counts one by default', async () => {
    recordUsage(TENANT, 'registration')
    await h.scheduled[0].task()
    expect(h.inserts[0].row).toEqual({ tenant_id: TENANT, kind: 'registration', count: 1 })
  })

  it.each([
    ['no tenant', null, 1],
    ['an empty tenant', '', 1],
    ['a zero count', TENANT, 0],
    ['a negative count', TENANT, -2],
    ['a fractional count', TENANT, 1.5],
  ])('is a no-op for %s', (_label, tenant, count) => {
    recordUsage(tenant, 'event', count)
    expect(h.scheduled).toHaveLength(0)
  })

  it('rejects inside the after-response task, which runAfterResponse logs and swallows', async () => {
    h.insertError = { message: 'boom' }
    recordUsage(TENANT, 'email')
    await expect(h.scheduled[0].task()).rejects.toThrow(/usage_events insert failed: boom/)
  })
})
