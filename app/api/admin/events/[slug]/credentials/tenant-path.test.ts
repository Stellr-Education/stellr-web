// @vitest-environment node
//
// S5 A10c: the credentials GET and the 'credentials' area. Another tenant's staff keep the
// Stellr-only option's 503 unless TENANT_DB_AREAS puts the area on the tenant path; then they
// get their own event's panel, read through tenantDb by lib/events/admin-credentials.ts (whose
// unit test drives the SQL). Stellr's own staff take the guarded route on every path, and with
// the flags unset the list is today's query. PATCH and POST stay Stellr-only on every path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const SLUG = 'test-event'
const TENANT = 'c0ffee00-0000-4000-8000-0000000000b2'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  tenantId: '',
  panel: vi.fn(),
  dbTouched: 0,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    h.dbTouched++
    return h.db.client
  },
}))
vi.mock('@/lib/authz', async () => {
  const { eventRouteFor } = await import('@/test/fixtures/event-route')
  return { requireEventRoute: async (slug: string) => eventRouteFor(slug, h.tenantId) }
})
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ title: 'Test Event', type: 'space' }) }))
vi.mock('@/lib/event-certificates', () => ({ listEventMentors: async () => [{ member_id: 'm1' }] }))
// The real gate and service reads; only the tenantDb read is a stand-in.
vi.mock('@/lib/events/admin-credentials', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events/admin-credentials')>('@/lib/events/admin-credentials')
  return { ...actual, loadTenantCredentialPanel: h.panel }
})

const { GET, POST, PATCH } = await import('./route')

const CRED = {
  id: '11111111-1111-4111-8111-111111111111',
  number: 'STL-2026-AAAA',
  source: 'event',
  event_slug: SLUG,
  award_type: 'participation',
  recipient_name: 'Ada Tester',
}

const get = (audience = 'students') =>
  GET(new Request(`https://app.stellreducation.org/api/admin/events/${SLUG}/credentials?audience=${audience}`), {
    params: Promise.resolve({ slug: SLUG }),
  })

const write = (fn: typeof POST) =>
  fn(
    new Request(`https://app.stellreducation.org/api/admin/events/${SLUG}/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ slug: SLUG }) },
  )

const tenantMode = (path: 'tenant' | 'shadow' = 'tenant') => {
  vi.stubEnv('TENANT_DB_ENABLED', 'true')
  vi.stubEnv('TENANT_DB_AREAS', `credentials:${path}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.dbTouched = 0
  h.tenantId = STELLR_TENANT_ID
  vi.stubEnv('TENANT_DB_ENABLED', '')
  vi.stubEnv('TENANT_DB_AREAS', '')
  h.db = fakeSupabase({
    events: [{ slug: SLUG, tenant_id: STELLR_TENANT_ID }],
    event_settings: [],
    registrations: [],
    participants: [],
    credentials: [CRED, { ...CRED, id: '22222222-2222-4222-8222-222222222222', award_type: 'mentor', recipient_name: 'Ben Mentor' }],
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("another tenant's staff", () => {
  beforeEach(() => {
    h.tenantId = TENANT
  })

  it('with the flags unset: the Stellr-only 503, and no tenantDb read', async () => {
    const res = await get()
    expect(res.status).toBe(503)
    expect(h.panel).not.toHaveBeenCalled()
  })

  it('in shadow mode: still the 503', async () => {
    tenantMode('shadow')
    expect((await get()).status).toBe(503)
    expect(h.panel).not.toHaveBeenCalled()
  })

  it('on the tenant path: their panel, from their own scope, never the service client', async () => {
    tenantMode()
    h.panel.mockResolvedValue({ settings: null, credentials: [CRED], checkedInCount: 2 })
    const res = await get('mentors')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      audience: 'mentors',
      settings: { credential_title: null, credential_description: null, credential_criteria: null, credential_skills: [] },
      credentials: [CRED],
      checkedInCount: 2,
      mentorCount: 0,
    })
    expect(h.panel).toHaveBeenCalledWith(TENANT, SLUG, 'mentors')
    expect(h.dbTouched).toBe(0)
  })

  it('on the tenant path, a failed tenantDb read is a 500 that names nothing', async () => {
    tenantMode()
    h.panel.mockRejectedValue(Object.assign(new Error('permission denied for table credentials'), { code: '42501' }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/permission/)
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/permission/)
    error.mockRestore()
  })

  it('on the tenant path, issuing and the wording stay Stellr-only', async () => {
    tenantMode()
    expect((await write(POST)).status).toBe(503)
    expect((await write(PATCH)).status).toBe(503)
    expect(h.panel).not.toHaveBeenCalled()
  })
})

describe("Stellr's own staff", () => {
  it("with the flags unset: today's list, by audience, and the mentor count", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { credentials: { id: string }[]; mentorCount: number }
    expect(body.credentials.map((c) => c.id)).toEqual([CRED.id])
    expect(body.mentorCount).toBe(1)
    expect(h.panel).not.toHaveBeenCalled()
  })

  it('on the tenant path: still the guarded route, never the tenant panel', async () => {
    tenantMode()
    // The list itself goes through tenantDb here; with no driver it fails closed, as a 500.
    await expect(get()).rejects.toThrow()
    expect(h.panel).not.toHaveBeenCalled()
  })
})
