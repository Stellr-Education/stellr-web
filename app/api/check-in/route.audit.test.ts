// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// Self check-in at the door (Staff role P3/P4, GATE-AUDIT, T-27). Nobody is signed in,
// so the actor is { userId: null } and the row says anonymous. A check-in goes on the
// chain of the event's owner once its code has matched, with the participant as the
// target; nothing typed at the door (name, date of birth, email, the code) reaches it.
// "Not you?" reads no record, so its event neither stores nor looks up the slug.

const SLUG = 'tenant-event-2027'
const OWNER = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  mirrored: [] as string[],
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
vi.mock('@/lib/events/mirror', () => ({
  getMirroredEvent: async (slug: string) => {
    h.mirrored.push(slug)
    return { slug, tenant_id: OWNER }
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ setting: 'in_person' }) }))
vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: async () => ({ tenantId: null }) }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null, limit: async () => ({ ok: true, retryAfterSeconds: 0 }) }))
vi.mock('@/lib/check-in-view', () => ({ loadCheckInView: async () => ({ firstName: 'x' }) }))
vi.mock('@/lib/app-errors', () => ({ reportError: async () => {} }))

const { POST, DELETE } = await import('./route')

const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const post = (fields: Record<string, unknown>) =>
  POST(new Request('https://app.test/api/check-in', { method: 'POST', body: JSON.stringify({ slug: SLUG, token: 'placeholder-token', ...fields }) }))

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.audits = []
  h.mirrored = []
  h.db = fakeSupabase({
    event_settings: [{ event_slug: SLUG, check_in_token: 'placeholder-token', check_in_open: true }],
    registrations: [
      {
        id: 'reg-1',
        event_slug: SLUG,
        status: 'confirmed',
        participants: [{ id: PARTICIPANT, first_name: 'Alex', last_name: 'Smith', nickname: null, date_of_birth: '2011-04-09', email: 'family@example.test', checked_in_at: null }],
      },
    ],
    participants: [{ id: PARTICIPANT, checked_in_at: null }],
  })
})

describe('POST /api/check-in', () => {
  it('a check-in is recorded as anonymous, on the owner’s chain, naming the participant', async () => {
    const res = await post({ email: 'family@example.test' })
    expect(res.status).toBe(200)
    await flush()
    expect(h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))).toEqual([
      {
        action: 'event.check_in.self_check_in',
        tenantId: OWNER,
        actor: 'system',
        target: { table: 'participants', id: PARTICIPANT },
        // actor_anonymous is resolveActor's answer for nobody signed in.
        metadata: { event_slug: SLUG, already_checked_in: false, by: 'email', status: 200, actor_anonymous: true },
      },
    ])
    expect(h.mirrored).toEqual([SLUG])
    expect(JSON.stringify(h.audits)).not.toMatch(/Alex|Smith|2011|example\.test|placeholder-token/)
  })

  it('a wrong event code is refused and records nothing', async () => {
    expect((await post({ token: 'wrong-placeholder', email: 'family@example.test' })).status).toBe(403)
    await flush()
    expect(h.audits).toEqual([])
  })

  it('with the flag off, nothing is scheduled or written', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    expect((await post({ email: 'family@example.test' })).status).toBe(200)
    await flush()
    expect(h.afters).toEqual([])
    expect(h.audits).toEqual([])
  })
})

describe('DELETE /api/check-in ("Not you?")', () => {
  it('records the forget on the platform chain, marked unresolved, and never looks up the slug', async () => {
    const res = await DELETE(new Request(`https://app.test/api/check-in?slug=${SLUG}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))).toEqual([
      { action: 'event.check_in.self_forget', tenantId: null, actor: 'system', target: null, metadata: { tenant_unresolved: true, actor_anonymous: true, status: 200 } },
    ])
    expect(h.mirrored).toEqual([])
    expect(JSON.stringify(h.audits)).not.toContain(SLUG)
  })
})
