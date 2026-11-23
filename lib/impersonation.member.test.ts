// @vitest-environment node
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// currentMemberId, viewAsBannerProps, the exact refusal bodies, and the edges of
// decodeTicket (the ticket's signature, shape and TTL).

const h = vi.hoisted(() => ({
  userId: 'clerk-admin' as string | null,
  role: 'admin' as string | undefined,
  cookie: undefined as string | undefined,
  db: null as unknown as FakeDb,
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: h.userId, sessionClaims: h.role ? { metadata: { role: h.role } } : null }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (h.cookie && name === 'stellr_impersonate' ? { value: h.cookie } : undefined) }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))

type Mod = typeof import('@/lib/impersonation')
let encodeTicket: Mod['encodeTicket']
let decodeTicket: Mod['decodeTicket']
let currentMemberId: Mod['currentMemberId']
let viewAsBannerProps: Mod['viewAsBannerProps']
let impersonatedMemberId: Mod['impersonatedMemberId']
let assertNotImpersonating: Mod['assertNotImpersonating']
let ImpersonationNotConfiguredError: Mod['ImpersonationNotConfiguredError']
let IMPERSONATION_TTL_SECONDS: Mod['IMPERSONATION_TTL_SECONDS']
let IMPERSONATION_COOKIE: Mod['IMPERSONATION_COOKIE']

// The module is loaded afresh before each test: its module-level constants
// and tables are evaluated at load, and a mutation run (stryker.config.mjs)
// switches a mutant on only after a file's static imports have run.
beforeEach(async () => {
  vi.resetModules()
  ;({ encodeTicket, decodeTicket, currentMemberId, viewAsBannerProps, impersonatedMemberId, assertNotImpersonating, ImpersonationNotConfiguredError, IMPERSONATION_TTL_SECONDS, IMPERSONATION_COOKIE } = await import('@/lib/impersonation'))
})

const SECRET = 'member-test-secret-of-at-least-32-chars'
const ADMIN = { id: 'admin-member', clerk_user_id: 'clerk-admin', first_name: 'Ada', last_name: 'Admin', email: 'admin@stellr.test', is_active: true }
const KID = { id: 'kid', clerk_user_id: 'clerk-kid', first_name: 'Kit', last_name: null, email: 'kid@school.test', is_active: true }
const NAMELESS_ADMIN = { id: 'nameless', clerk_user_id: 'clerk-nameless', first_name: null, last_name: null, email: 'nameless@stellr.test', is_active: true }

const ticketFor = (memberId: string, adminMemberId = ADMIN.id, issuedAt = Date.now()) =>
  encodeTicket({ memberId, adminMemberId, issuedAt })

/** A correctly signed value carrying any payload. */
function signed(payloadObj: unknown): string {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url')
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`
}

beforeEach(() => {
  vi.stubEnv('IMPERSONATION_SECRET', SECRET)
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_other')
  vi.stubEnv('CRON_SECRET', 'cron-other')
  h.userId = 'clerk-admin'
  h.role = 'admin'
  h.cookie = undefined
  h.db = fakeSupabase({ members: [ADMIN, KID, NAMELESS_ADMIN] })
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('decodeTicket edges', () => {
  it('the cookie name and TTL are as documented', () => {
    expect(IMPERSONATION_COOKIE).toBe('stellr_impersonate')
    expect(IMPERSONATION_TTL_SECONDS).toBe(1800)
  })

  it('accepts a ticket just inside the TTL and refuses one just past it', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-22T12:00:00Z'))
      const issuedAt = Date.now()
      const raw = ticketFor(KID.id, ADMIN.id, issuedAt)
      vi.setSystemTime(issuedAt + 1800 * 1000)
      expect(decodeTicket(raw)).toEqual({ memberId: KID.id, adminMemberId: ADMIN.id, issuedAt })
      vi.setSystemTime(issuedAt + 1800 * 1000 + 1)
      expect(decodeTicket(raw)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a signed ticket with a missing member, a non-numeric issuedAt or a non-string admin', () => {
    const now = Date.now()
    expect(decodeTicket(signed({ memberId: KID.id, adminMemberId: ADMIN.id, issuedAt: now }))).not.toBeNull()
    expect(decodeTicket(signed({ memberId: '', adminMemberId: ADMIN.id, issuedAt: now }))).toBeNull()
    expect(decodeTicket(signed({ memberId: KID.id, adminMemberId: ADMIN.id, issuedAt: String(now) }))).toBeNull()
    expect(decodeTicket(signed({ memberId: KID.id, adminMemberId: 7, issuedAt: now }))).toBeNull()
    expect(decodeTicket(signed(null))).toBeNull()
  })

  it('refuses a value with nothing before the dot, or nothing after it', () => {
    const raw = ticketFor(KID.id)
    const [payload] = raw.split('.')
    expect(decodeTicket(`.${raw.split('.')[1]}`)).toBeNull()
    expect(decodeTicket(`${payload}.`)).toBeNull()
    expect(decodeTicket(undefined)).toBeNull()
  })

  it('refuses a signature of the right length that differs', () => {
    const raw = ticketFor(KID.id)
    const dot = raw.lastIndexOf('.')
    const sig = raw.slice(dot + 1)
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(decodeTicket(`${raw.slice(0, dot)}.${flipped}`)).toBeNull()
  })

  it('signs with the dedicated key: a ticket signed with another key is refused', () => {
    const payload = Buffer.from(JSON.stringify({ memberId: KID.id, adminMemberId: ADMIN.id, issuedAt: Date.now() })).toString('base64url')
    const other = createHmac('sha256', 'x'.repeat(40)).update(payload).digest('base64url')
    expect(decodeTicket(`${payload}.${other}`)).toBeNull()
  })

  it('encodeTicket refuses a ticket with no member', () => {
    expect(() => encodeTicket({ memberId: '', adminMemberId: ADMIN.id, issuedAt: 1 })).toThrow(
      'An impersonation ticket needs both the member and the issuing admin.',
    )
  })

  it('the not-configured error is named and tells the operator what is wrong', () => {
    vi.stubEnv('IMPERSONATION_SECRET', '')
    const err = new ImpersonationNotConfiguredError()
    expect(err.name).toBe('ImpersonationNotConfiguredError')
    expect(err.message).toBe(
      'View as member is switched off on this deployment: IMPERSONATION_SECRET is not set ' +
        '(it must be its own random value of at least 32 characters).',
    )
    vi.stubEnv('IMPERSONATION_SECRET', 'a'.repeat(31))
    expect(new ImpersonationNotConfiguredError().message).toContain('IMPERSONATION_SECRET is shorter than 32 characters')
    vi.stubEnv('IMPERSONATION_SECRET', 'a'.repeat(32))
    expect(() => encodeTicket({ memberId: KID.id, adminMemberId: ADMIN.id, issuedAt: 1 })).not.toThrow()
    vi.stubEnv('CRON_SECRET', 'a'.repeat(32))
    expect(new ImpersonationNotConfiguredError().message).toContain('IMPERSONATION_SECRET is a copy of CLERK_SECRET_KEY or CRON_SECRET')
  })
})

describe('the refusal bodies', () => {
  it('a live view-as write gets a JSON 403 saying it is read-only', async () => {
    h.cookie = ticketFor(KID.id)
    const res = await assertNotImpersonating()
    expect(res?.status).toBe(403)
    expect(res?.headers.get('Content-Type')).toBe('application/json')
    expect(await res?.json()).toEqual({
      error: 'Read-only while viewing as a member. Exit view-as to make changes.',
      impersonating: true,
    })
  })

  it('an unverified ticket gets a JSON 503 that says nothing changed', async () => {
    h.cookie = ticketFor(KID.id)
    h.db = fakeSupabase({ members: [ADMIN, KID] }, { failOn: (t) => (t === 'members' ? 'boom' : null) })
    const res = await assertNotImpersonating()
    expect(res?.status).toBe(503)
    expect(res?.headers.get('Content-Type')).toBe('application/json')
    expect(await res?.json()).toEqual({
      error: 'Could not confirm whether you are viewing as a member, so nothing was changed. Try again.',
    })
  })
})

describe('currentMemberId', () => {
  it('is the viewed member while view-as is live', async () => {
    h.cookie = ticketFor(KID.id)
    expect(await impersonatedMemberId()).toBe(KID.id)
    expect(await currentMemberId()).toBe(KID.id)
  })

  it("is the caller's own member id otherwise", async () => {
    expect(await impersonatedMemberId()).toBeNull()
    expect(await currentMemberId()).toBe(ADMIN.id)
    h.userId = 'clerk-kid'
    expect(await currentMemberId()).toBe(KID.id)
  })

  it('uses the client it is given', async () => {
    const other = fakeSupabase({ members: [{ ...KID, clerk_user_id: 'clerk-admin' }] })
    expect(await currentMemberId(other.client)).toBe(KID.id)
  })

  it('is null when signed out, or with no member row', async () => {
    h.userId = null
    expect(await currentMemberId()).toBeNull()
    h.userId = 'clerk-nobody'
    expect(await currentMemberId()).toBeNull()
  })
})

describe('viewAsBannerProps', () => {
  it('is null with no view-as session, or no member', async () => {
    expect(await viewAsBannerProps({ first_name: 'Kit', last_name: null, email: null })).toBeNull()
    h.cookie = ticketFor(KID.id)
    expect(await viewAsBannerProps(null)).toBeNull()
  })

  it('names the viewed member and the admin from the ticket', async () => {
    h.cookie = ticketFor(KID.id)
    expect(await viewAsBannerProps({ first_name: 'Kit', last_name: 'Kid', email: 'kid@school.test' })).toEqual({
      memberId: KID.id,
      memberName: 'Kit Kid',
      adminName: 'Ada Admin',
    })
  })

  it('falls back to the email, then to "this member"; an admin with no name is their email', async () => {
    h.userId = 'clerk-nameless'
    h.cookie = ticketFor(KID.id, NAMELESS_ADMIN.id)
    expect(await viewAsBannerProps({ first_name: null, last_name: null, email: 'kid@school.test' })).toEqual({
      memberId: KID.id,
      memberName: 'kid@school.test',
      adminName: 'nameless@stellr.test',
    })
    expect((await viewAsBannerProps({ first_name: null, last_name: null, email: null }))?.memberName).toBe('this member')
    expect((await viewAsBannerProps({ first_name: null, last_name: 'Kid', email: null }))?.memberName).toBe('Kid')
  })

  it("has no admin name when the admin's row cannot be read", async () => {
    h.cookie = ticketFor(KID.id)
    const real = h.db as unknown as { client: { from: (t: string) => unknown } }
    let calls = 0
    // The first members read binds the ticket; the second names the admin.
    h.db = {
      client: {
        from: (t: string) => {
          calls++
          return calls === 1 ? real.client.from(t) : (fakeSupabase({ members: [] }).client as unknown as { from: (t: string) => unknown }).from(t)
        },
      },
    } as unknown as FakeDb
    expect(await viewAsBannerProps({ first_name: 'Kit', last_name: null, email: null })).toEqual({
      memberId: KID.id,
      memberName: 'Kit',
      adminName: null,
    })
  })
})
