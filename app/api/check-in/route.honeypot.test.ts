// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// spam.L1b at the door (docs/REC-form-spam-hardening.md): the check-in form's
// honeypot. A filled one gets the same silent 200 the other public forms give
// (lib/spam-guard.ts), and nothing is read or written: no check-in, no cookie.
// There is no timing trap at check-in, so an instant submission still checks in.

const SLUG = 'tenant-event-2027'
const OWNER = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  dbOpened: 0,
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
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    h.dbOpened++
    return h.db.client
  },
}))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ setting: 'in_person' }) }))
// The door is on the event owner's host (A12 refuses another tenant's event elsewhere).
vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: async () => ({ tenantId: '11111111-1111-4111-8111-111111111111' }) }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null, limit: async () => ({ ok: true, retryAfterSeconds: 0 }) }))
vi.mock('@/lib/check-in-view', () => ({ loadCheckInView: async () => ({ firstName: 'x' }) }))
vi.mock('@/lib/app-errors', () => ({ reportError: async () => {} }))

const { POST } = await import('./route')

const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const post = (fields: Record<string, unknown>) =>
  POST(new Request('https://app.test/api/check-in', { method: 'POST', body: JSON.stringify({ slug: SLUG, token: 'placeholder-token', ...fields }) }))
const checkedInAt = () => h.db.table('participants').find((p) => p.id === PARTICIPANT)?.checked_in_at ?? null

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.unstubAllEnvs()
  // Production: the honeypot bites everywhere, and a timing trap (were there one) only here.
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.dbOpened = 0
  h.afters = []
  h.audits = []
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.db = fakeSupabase({
    event_settings: [{ event_slug: SLUG, check_in_token: 'placeholder-token', check_in_open: true }],
    events: [{ slug: SLUG, tenant_id: OWNER }],
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

describe('POST /api/check-in: honeypot', () => {
  it.each([
    ['by email', { email: 'family@example.test' }],
    ['by name and date of birth', { firstName: 'Alex', lastName: 'Smith', dob: '2011-04-09' }],
  ])('a filled honeypot (%s) gets a silent 200 and writes no check-in', async (_l, fields) => {
    const res = await post({ ...fields, website: 'https://spam.example' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(checkedInAt()).toBeNull()
    // Nothing is read either: the database is never opened.
    expect(h.dbOpened).toBe(0)
    expect(warn).toHaveBeenCalledWith('[spam] honeypot', 'check-in')
  })

  it('a trip is recorded unplaced on the platform chain, naming no participant and nothing typed', async () => {
    await post({ email: 'family@example.test', website: 'https://spam.example' })
    await flush()
    expect(h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, target: a.target, metadata: a.metadata }))).toEqual([
      {
        action: 'event.check_in.self_check_in',
        tenantId: null,
        target: { table: 'participants', id: null },
        metadata: { spam_trap: 'honeypot', tenant_unresolved: true, status: 200, actor_anonymous: true },
      },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Alex|example|placeholder-token|tenant-event/)
  })

  it('a normal submission with an empty honeypot checks in as before', async () => {
    const res = await post({ email: 'family@example.test', website: '' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ view: { firstName: 'x' }, alreadyCheckedIn: false })
    expect(checkedInAt()).not.toBeNull()
  })

  it('no timing trap at the door: an instant submission, even with timing sent, checks in', async () => {
    const now = Date.now()
    const res = await post({ email: 'family@example.test', website: '', renderedAt: now - 100, submittedAt: now })
    expect(res.status).toBe(200)
    expect(checkedInAt()).not.toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('a body with no honeypot field at all (an older page) checks in', async () => {
    const res = await post({ email: 'family@example.test' })
    expect(res.status).toBe(200)
    expect(checkedInAt()).not.toBeNull()
  })
})
