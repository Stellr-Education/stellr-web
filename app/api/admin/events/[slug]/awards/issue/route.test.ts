// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/admin/events/[slug]/awards/issue (legacy-17.16): turns the judged awards into
// credentials. The access gate answers first and nothing is read or issued for a caller it
// refuses; an allowed caller's run is passed the event's title and theme and answered with
// its counts; and with platform audit on, the run records one event with those counts.

const SLUG = 'tenant-event-2027'
const OWNER = '11111111-1111-4111-8111-111111111111'
const CALLER = 'user_managerplaceholder'

const RESULT = { issued: 3, students: 2, reinstated: 1, revoked: 1, unchanged: 4, emailed: 2, skipped: 1, skips: [{ name: 'A Student', reason: 'consent' }], failures: [] as string[] }

const h = vi.hoisted(() => ({
  access: null as unknown as Record<string, unknown>,
  event: null as Record<string, unknown> | null,
  issueAwards: vi.fn(),
  getEventBySlug: vi.fn(),
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    h.afters.push(task)
  },
}))
vi.mock('@/lib/audit/platform', async (orig) => ({
  ...(await orig<typeof import('@/lib/audit/platform')>()),
  audit: async (input: Record<string, unknown>) => {
    h.audits.push(input)
    return { ok: true, id: h.audits.length, chainSeq: h.audits.length }
  },
}))
vi.mock('@/lib/events/mirror', () => ({ getMirroredEvent: async (slug: string) => ({ slug, tenant_id: OWNER }) }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: CALLER }) }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => h.access }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: () => ({}) }) }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/event-award-issue', () => ({ issueAwards: h.issueAwards }))

const { POST } = await import('./route')

const issue = () => POST(new Request(`https://app.test/api/admin/events/${SLUG}/awards/issue`, { method: 'POST' }), { params: Promise.resolve({ slug: SLUG }) })
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  h.access = { ok: true, userId: CALLER, isAdmin: false, assignedSlugs: [SLUG] }
  h.event = { title: 'Tenant Event 2027', type: 'space' }
  h.issueAwards.mockReset()
  h.issueAwards.mockResolvedValue(RESULT)
  h.getEventBySlug.mockReset()
  h.getEventBySlug.mockImplementation(async () => h.event)
  h.afters = []
  h.audits = []
})

describe('POST /api/admin/events/[slug]/awards/issue', () => {
  it.each([401, 403] as const)('answers %i for a caller the event gate refuses, and issues nothing', async (status) => {
    h.access = { ok: false, status }
    const res = await issue()
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(h.getEventBySlug).not.toHaveBeenCalled()
    expect(h.issueAwards).not.toHaveBeenCalled()
  })

  it("issues for an allowed caller, with the event's title and theme, and answers with the run", async () => {
    const res = await issue()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ...RESULT })
    expect(h.issueAwards).toHaveBeenCalledWith(expect.anything(), SLUG, { eventTitle: 'Tenant Event 2027', theme: 'space' })
  })

  it("an environmental event's awards carry that theme; an event Sanity lacks uses its slug as the title", async () => {
    h.event = { title: 'Enviro Day', type: 'Environmental' }
    await issue()
    expect(h.issueAwards).toHaveBeenLastCalledWith(expect.anything(), SLUG, { eventTitle: 'Enviro Day', theme: 'environmental' })
    h.event = null
    await issue()
    expect(h.issueAwards).toHaveBeenLastCalledWith(expect.anything(), SLUG, { eventTitle: SLUG, theme: 'space' })
  })

  it('with platform audit on, records one event with the run’s counts and no names', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    expect((await issue()).status).toBe(200)
    await flush()
    expect(h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))).toEqual([
      {
        action: 'event.awards.issue',
        tenantId: OWNER,
        actor: CALLER,
        target: { table: 'credentials', id: null },
        metadata: { event_slug: SLUG, issued: 3, students: 2, reinstated: 1, revoked: 1, unchanged: 4, notified: 2, skipped: 1, failed: 0, status: 200 },
      },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('A Student')
  })

  it('with platform audit on, a refused caller records nothing; with it off, an issue records nothing', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    h.access = { ok: false, status: 403 }
    await issue()
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    h.access = { ok: true, userId: CALLER, isAdmin: true, assignedSlugs: null }
    await issue()
    await flush()
    expect(h.afters).toEqual([])
    expect(h.audits).toEqual([])
  })
})
