// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The monthly email_events prune: guarded like every cron, records its run in
// cron_runs, and fails closed when the delete fails.

const h = vi.hoisted(() => ({
  blocked: null as Response | null,
  clients: 0,
  runs: [] as { job: string; failed: string[]; result: unknown }[],
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
vi.mock('@/lib/email/events', () => ({
  EMAIL_EVENTS_RETENTION_MONTHS: 13,
  pruneEmailEvents: async () => {
    if (h.throws) throw new Error('db down')
    return { cutoff: '2025-10-23T00:00:00.000Z', deleted: 7 }
  },
}))

const { GET } = await import('./route')
const req = () => new Request('https://app.test/api/cron/email-events-retention') as unknown as Parameters<typeof GET>[0]

beforeEach(() => {
  h.blocked = null
  h.clients = 0
  h.runs = []
  h.throws = false
})

describe('GET /api/cron/email-events-retention', () => {
  it('answers the guard first', async () => {
    h.blocked = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    expect((await GET(req())).status).toBe(401)
    expect(h.clients).toBe(0)
  })

  it('prunes and records the run in cron_runs', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cutoff: '2025-10-23T00:00:00.000Z', deleted: 7 })
    expect(h.runs).toEqual([{ job: 'email-events-retention', failed: [], result: { retentionMonths: 13, cutoff: '2025-10-23T00:00:00.000Z', deleted: 7 } }])
  })

  it('records a failed delete as a failed run and answers 500', async () => {
    h.throws = true
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(h.runs[0].failed).toEqual(['prune'])
  })
})
