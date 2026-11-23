// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S6-USE: the usage-rollup cron is inert with USAGE_METERING_ENABLED off (no
// client, no cron_runs row), guarded like every cron, and with the flag on records
// its run and fails closed when a step fails.

const h = vi.hoisted(() => ({
  blocked: null as Response | null,
  clients: 0,
  runs: [] as { job: string; failed: string[]; result: unknown }[],
  rollup: { days: [{ day: '2026-11-22', rows: 3 }, { day: '2026-11-23', rows: 1 }], purged: 0, failures: 0 } as Record<string, unknown>,
  throws: false,
}))

vi.mock('@/lib/cron', () => ({ guardCron: () => h.blocked }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    h.clients++
    return {}
  },
}))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async (_db: unknown, job: string) => {
    const run = { job, failed: [] as string[], result: undefined as unknown }
    h.runs.push(run)
    return {
      id: 'run-1',
      fail: (where: string) => run.failed.push(where),
      finish: async (result: unknown) => {
        run.result = result
      },
    }
  },
}))
vi.mock('@/lib/usage/rollup', () => ({
  runUsageRollup: async () => {
    if (h.throws) throw new Error('db down')
    return h.rollup
  },
}))

const { GET } = await import('./route')
const req = () => new Request('https://app.test/api/cron/usage-rollup') as unknown as Parameters<typeof GET>[0]

beforeEach(() => {
  h.blocked = null
  h.clients = 0
  h.runs = []
  h.throws = false
  h.rollup = { days: [{ day: '2026-11-22', rows: 3 }, { day: '2026-11-23', rows: 1 }], purged: 0, failures: 0 }
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/usage-rollup', () => {
  it('answers the guard first', async () => {
    vi.stubEnv('USAGE_METERING_ENABLED', 'true')
    h.blocked = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(h.clients).toBe(0)
  })

  it.each([undefined, 'false', 'TRUE'])('does nothing with the flag %s: no client, no cron_runs row', async (flag) => {
    vi.stubEnv('USAGE_METERING_ENABLED', flag as string)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: true, reason: 'USAGE_METERING_ENABLED is off' })
    expect(h.clients).toBe(0)
    expect(h.runs).toHaveLength(0)
  })

  it('with the flag on, rolls up and records the run in cron_runs', async () => {
    vi.stubEnv('USAGE_METERING_ENABLED', 'true')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(h.rollup)
    expect(h.runs).toEqual([{ job: 'usage-rollup', failed: [], result: h.rollup }])
  })

  it('answers 500 when a step failed', async () => {
    vi.stubEnv('USAGE_METERING_ENABLED', 'true')
    h.rollup = { ...h.rollup, purged: null, failures: 1 }
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it('records a thrown error as a failed run', async () => {
    vi.stubEnv('USAGE_METERING_ENABLED', 'true')
    h.throws = true
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
    expect(h.runs[0].failed).toEqual(['usage-rollup'])
  })
})
