// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S6-SUP: the full support-session check (lib/authz/support-session-server.ts) and the
// read helper it unlocks (tenantSupportDb). A read under a session needs the cookie, its
// Clerk binding and an open support_sessions row; the helper then runs as
// tenant_support_ro, READ ONLY, pinned to the session's tenant, and nothing else.

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  cookieReads: 0,
  clerk: { userId: 'user_platformAdmin1' as string | null, sessionId: 'sess_abc123' as string | null },
  row: null as Record<string, unknown> | null,
  readError: false,
}))

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
vi.mock('next/headers', () => ({
  cookies: async () => {
    h.cookieReads += 1
    return { get: () => (h.cookie ? { value: h.cookie } : undefined) }
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => h.clerk }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => (h.readError ? { data: null, error: { message: 'down' } } : { data: h.row, error: null }) }),
      }),
    }),
  }),
}))

const { encodeSupportTicket, SUPPORT_SESSION_COOKIE } = await import('@/lib/authz/support-session')
const { loadSupportSession, isVerifiedSupportSession } = await import('@/lib/authz/support-session-server')
const { tenantSupportDb } = await import('./support-db')
const { PIN_CHECK_SQL, READ_ONLY_CHECK_SQL, READ_ONLY_SQL, SUPPORT_ROLE, TenantContextError } = await import('./db')
type TenantSqlDriver = import('./db').TenantSqlDriver

const SECRET = 'support-secret-for-tests-only-0123456789'
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const SID = '5e550000-0000-4000-8000-00000000000a'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const ENDS = NOW + 30 * 60_000

const ticket = (over: Record<string, unknown> = {}) =>
  encodeSupportTicket({ v: 1, sid: SID, tid: TENANT, uid: 'user_platformAdmin1', csid: 'sess_abc123', mode: 'read', exp: ENDS, ...over })
const openRow = (over: Record<string, unknown> = {}) => ({
  id: SID,
  tenant_id: TENANT,
  platform_admin_user_id: 'user_platformAdmin1',
  mode: 'read',
  ends_at: new Date(ENDS).toISOString(),
  closed_at: null,
  tenants: { display_name: 'Sup Canary' },
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
  vi.stubEnv('SUPPORT_SESSION_SECRET', SECRET)
  h.cookie = ticket()
  h.cookieReads = 0
  h.clerk = { userId: 'user_platformAdmin1', sessionId: 'sess_abc123' }
  h.row = openRow()
  h.readError = false
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('loadSupportSession', () => {
  it('flag off: null, without reading the cookie', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'false')
    expect(await loadSupportSession()).toBeNull()
    expect(h.cookieReads).toBe(0)
  })

  it('a valid cookie, the bound Clerk session and an open row: the session, verified', async () => {
    const s = await loadSupportSession()
    expect(s).toMatchObject({ sessionId: SID, tenantId: TENANT, tenantName: 'Sup Canary', mode: 'read', endsAt: ENDS })
    expect(isVerifiedSupportSession(s)).toBe(true)
  })

  it.each([
    ['no cookie', () => (h.cookie = undefined)],
    ['a forged cookie', () => (h.cookie = `${ticket().split('.')[0]}.forged`)],
    ['an expired cookie', () => (h.cookie = ticket({ exp: NOW - 1 }))],
    ['another Clerk session', () => (h.clerk = { userId: 'user_platformAdmin1', sessionId: 'sess_other' })],
    ['another Clerk user', () => (h.clerk = { userId: 'user_someoneElse', sessionId: 'sess_abc123' })],
    ['signed out', () => (h.clerk = { userId: null, sessionId: null })],
    ['no row', () => (h.row = null)],
    ['a closed row', () => (h.row = openRow({ closed_at: new Date(NOW - 1000).toISOString() }))],
    ['an ended row', () => (h.row = openRow({ ends_at: new Date(NOW - 1).toISOString() }))],
    ['a row for another tenant', () => (h.row = openRow({ tenant_id: '5e550000-0000-4000-8000-0000000000c3' }))],
    ['a row for another admin', () => (h.row = openRow({ platform_admin_user_id: 'user_someoneElse' }))],
    ['a row in another mode', () => (h.row = openRow({ mode: 'break_glass' }))],
    ['a failed read', () => (h.readError = true)],
  ])('%s: null', async (_name, arrange) => {
    arrange()
    expect(await loadSupportSession()).toBeNull()
  })

  it('the earlier of the row and the ticket ends it', async () => {
    h.row = openRow({ ends_at: new Date(NOW + 5 * 60_000).toISOString() })
    expect((await loadSupportSession())?.endsAt).toBe(NOW + 5 * 60_000)
  })
})

/** A stand-in Postgres that reports the role and tenant the transaction set. */
function fakeDriver() {
  const calls: string[] = []
  const driver: TenantSqlDriver = {
    async transaction(fn) {
      let role = 'tenant_app_login'
      let tenant: string | null = null
      let readOnly = false
      return fn({
        async query(text, values) {
          calls.push(text)
          if (text === READ_ONLY_SQL) readOnly = true
          else if (text === READ_ONLY_CHECK_SQL) return { rows: [{ read_only: readOnly ? 'on' : 'off' } as never], rowCount: 1 }
          else if (text.startsWith('SET LOCAL ROLE ')) role = text.slice('SET LOCAL ROLE '.length)
          else if (text.includes('set_config')) tenant = String(values?.[0])
          else if (text === PIN_CHECK_SQL) return { rows: [{ role, tenant } as never], rowCount: 1 }
          return { rows: [], rowCount: 0 }
        },
      })
    },
  }
  return { driver, calls }
}

describe('tenantSupportDb', () => {
  it('runs as tenant_support_ro, READ ONLY, pinned to the session tenant', async () => {
    const session = await loadSupportSession()
    const { driver, calls } = fakeDriver()
    const db = tenantSupportDb(session!, { driver })
    expect(db.tenantId).toBe(TENANT)
    await db.sql`SELECT id FROM public.events`
    expect(calls.slice(0, 4)).toEqual([READ_ONLY_SQL, `SET LOCAL ROLE ${SUPPORT_ROLE}`, "SELECT set_config('stellr.tenant_id', $1, true)", PIN_CHECK_SQL])
    expect(calls).toContain(READ_ONLY_CHECK_SQL)
  })

  it('refuses a write before it is sent', async () => {
    const session = await loadSupportSession()
    const { driver, calls } = fakeDriver()
    await expect(tenantSupportDb(session!, { driver }).sql`UPDATE public.events SET title = ${'x'}`).rejects.toThrow(TenantContextError)
    expect(calls).toEqual([])
  })

  it('refuses a hand-made session, and one that has since ended', async () => {
    const { driver } = fakeDriver()
    const fake = { sessionId: SID, tenantId: TENANT, tenantName: 'x', platformAdminUserId: 'user_platformAdmin1', mode: 'read' as const, endsAt: ENDS }
    expect(() => tenantSupportDb(fake, { driver })).toThrow(TenantContextError)
    const session = await loadSupportSession()
    vi.setSystemTime(ENDS)
    expect(() => tenantSupportDb(session!, { driver })).toThrow(TenantContextError)
  })

  it('a connection that does not become tenant_support_ro is rolled back', async () => {
    const session = await loadSupportSession()
    const driver: TenantSqlDriver = {
      async transaction(fn) {
        return fn({
          async query(text) {
            if (text === READ_ONLY_CHECK_SQL) return { rows: [{ read_only: 'on' } as never], rowCount: 1 }
            if (text === PIN_CHECK_SQL) return { rows: [{ role: 'tenant_app', tenant: TENANT } as never], rowCount: 1 }
            return { rows: [], rowCount: 0 }
          },
        })
      },
    }
    await expect(tenantSupportDb(session!, { driver }).sql`SELECT 1`).rejects.toThrow(/could not pin/)
  })
})

it('the cookie name is the one the route sets', () => {
  expect(SUPPORT_SESSION_COOKIE).toBe('stellr_support_session')
})
