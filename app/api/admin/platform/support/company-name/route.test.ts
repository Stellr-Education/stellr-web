// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S6-SUP-UI: break-glass's first real change. Only in a verified break-glass session, only
// through tenantBreakGlassDb pinned to the SESSION's tenant, and audited on that tenant's
// chain with support_session. A read session, an ended one, or none: refused, nothing written.

const ADMIN = 'user_platformAdmin1'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const SID = '5e550000-0000-4000-8000-00000000000a'
const COMPANY = 'c0000000-0000-4000-8000-000000000001'
const SECRET = 's'.repeat(40)

const h = vi.hoisted(() => ({
  platformAdmin: true,
  host: 'stellr' as 'stellr' | 'tenant',
  session: null as null | { mode: 'read' | 'break_glass'; tenantId: string; sessionId: string },
  changed: 1,
  dbThrows: false,
  dbTenants: [] as string[],
  writes: [] as unknown[][],
}))
const audit = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ ok: true, id: 'evt' })))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_platformAdmin1' }) }))
vi.mock('@/lib/authz', () => ({ assertPlatformAdmin: async () => (h.platformAdmin ? { ok: true } : { ok: false, status: 403 }) }))
vi.mock('@/lib/authz/support-session-server', () => ({ loadSupportSession: async () => h.session }))
vi.mock('@/lib/tenancy/request-tenant', () => ({
  requestTenant: async () => (h.host === 'stellr' ? { kind: 'stellr' } : { kind: 'tenant', tenantId: TENANT, tenantSlug: 'b' }),
}))
vi.mock('@/lib/tenancy/support-db', () => ({
  tenantBreakGlassDb: (s: { mode: string; tenantId: string }) => {
    if (s.mode !== 'break_glass') throw new Error('not break-glass')
    h.dbTenants.push(s.tenantId)
    return {
      tenantId: s.tenantId,
      sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (h.dbThrows) throw new Error('refused')
        h.writes.push([strings.join('?'), ...values])
        return Array.from({ length: h.changed }, () => ({ id: COMPANY }))
      },
    }
  },
}))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: (_n: string, fn: () => unknown) => fn() }))
vi.mock('@/lib/audit/platform', async (orig) => ({ ...(await orig<typeof import('@/lib/audit/platform')>()), auditEnabled: () => true, audit }))

const { POST } = await import('./route')
const { encodeSupportTicket, SUPPORT_SESSION_COOKIE } = await import('@/lib/authz/support-session')

const ticket = (mode: 'read' | 'break_glass', exp = Date.now() + 10 * 60_000) =>
  encodeSupportTicket({ v: 1, sid: SID, tid: TENANT, uid: ADMIN, csid: 'sess_abc123', mode, exp })
const rename = (body: unknown = { eventSlug: 'bravo-2027', companyId: COMPANY, name: '  The Comets ' }, cookie?: string) =>
  POST(
    new Request('https://www.example.test/api/admin/platform/support/company-name', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `${SUPPORT_SESSION_COOKIE}=${cookie}` } : {}) },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
  vi.stubEnv('SUPPORT_SESSION_SECRET', SECRET)
  Object.assign(h, { platformAdmin: true, host: 'stellr', changed: 1, dbThrows: false })
  h.session = { mode: 'break_glass', tenantId: TENANT, sessionId: SID }
  h.dbTenants = []
  h.writes = []
  audit.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('refusals, with nothing written', () => {
  it('off, or a tenant host: 404', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', '')
    expect((await rename()).status).toBe(404)
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    h.host = 'tenant'
    expect((await rename(undefined, ticket('break_glass'))).status).toBe(404)
    expect(h.writes).toEqual([])
  })

  it('not a platform admin: 403', async () => {
    h.platformAdmin = false
    expect((await rename(undefined, ticket('break_glass'))).status).toBe(403)
    expect(h.writes).toEqual([])
  })

  it('no session at all: 403 break_glass_required', async () => {
    h.session = null
    const res = await rename()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'break_glass_required' })
    expect(h.writes).toEqual([])
  })

  it('a read session: 403 support_read_only, before the handler runs', async () => {
    h.session = { mode: 'read', tenantId: TENANT, sessionId: SID }
    const res = await rename(undefined, ticket('read'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'support_read_only' })
    expect(h.dbTenants).toEqual([])
  })

  it('a break-glass cookie past its end: 403 support_session_ended', async () => {
    const res = await rename(undefined, ticket('break_glass', Date.now() - 1))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'support_session_ended' })
    expect(h.writes).toEqual([])
  })

  it('bad input: 400', async () => {
    for (const body of [
      { eventSlug: 'Bad Slug', companyId: COMPANY, name: 'x' },
      { eventSlug: 'bravo', companyId: 'nope', name: 'x' },
      { eventSlug: 'bravo', companyId: COMPANY, name: 7 },
      { eventSlug: 'bravo', companyId: COMPANY, name: 'x'.repeat(81) },
    ]) {
      expect((await rename(body, ticket('break_glass'))).status, JSON.stringify(body)).toBe(400)
    }
    expect(h.writes).toEqual([])
  })
})

describe('under break-glass', () => {
  it('writes through tenantBreakGlassDb pinned to the session tenant, and audits on that chain with the session', async () => {
    const res = await rename(undefined, ticket('break_glass'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ companyId: COMPANY, name: 'The Comets' })
    expect(h.dbTenants).toEqual([TENANT])
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].slice(1)).toEqual(['The Comets', COMPANY, 'bravo-2027'])
    // withAudit writes after the response.
    await vi.waitFor(() => expect(audit).toHaveBeenCalledOnce())
    expect(audit.mock.calls[0][0]).toMatchObject({
      tenantId: TENANT,
      actor: ADMIN,
      action: 'support.company.rename',
      reason: 'break_glass',
      metadata: { status: 200, support_session: SID },
    })
  })

  it('an empty name clears it', async () => {
    await rename({ eventSlug: 'bravo-2027', companyId: COMPANY, name: '   ' }, ticket('break_glass'))
    expect(h.writes[0][1]).toBeNull()
  })

  it('no such company in the session tenant: 404, and nothing audited', async () => {
    h.changed = 0
    expect((await rename(undefined, ticket('break_glass'))).status).toBe(404)
    expect(audit).not.toHaveBeenCalled()
  })

  it('the database refusing: 503', async () => {
    h.dbThrows = true
    expect((await rename(undefined, ticket('break_glass'))).status).toBe(503)
  })
})
