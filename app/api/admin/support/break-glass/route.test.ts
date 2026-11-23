// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S6-BG: opening and renewing break-glass. The S6 gate's four refusals, each here:
// no consent, no reason, no step-up, past the time limit. Plus the doors S6-SUP set:
// off or a tenant host is a 404, platform admins only, and nothing stands unless the
// tenant's audit chain records it.

const ADMIN = 'user_platformAdmin1'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const SID = '5e550000-0000-4000-8000-00000000000a'
const CONSENT = 'bc000000-0000-4000-8000-0000000000c1'
const REASON = 'Fixing the stuck registration for ticket 4521'
const SECRET = 's'.repeat(40)

const h = vi.hoisted(() => ({
  clerk: { userId: 'user_platformAdmin1' as string | null, sessionId: 'sess_abc123' as string | null },
  platformAdmin: true,
  tenantKind: 'stellr' as 'stellr' | 'tenant',
  stepUpFresh: true,
  audit: true,
  auditOk: true,
  jar: new Map<string, { value: string; opts: Record<string, unknown> }>(),
  rpc: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as [string, Record<string, unknown>][],
  updates: [] as { values: Record<string, unknown>; filters: [string, unknown][] }[],
}))

const auditMutation = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => (h.auditOk ? { ok: true, id: 'evt' } : { ok: false, error: 'down' })))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ ...h.clerk, has: () => h.stepUpFresh }),
  reverificationErrorResponse: () => new Response(JSON.stringify({ clerk_error: { type: 'forbidden', reason: 'reverification-error' } }), { status: 403 }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { value: h.jar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts: Record<string, unknown>) => h.jar.set(name, { value, opts }),
  }),
}))
vi.mock('@/lib/authz', async () => {
  const { writeRefusal } = await import('@/lib/authz/writable')
  return { assertPlatformAdmin: async () => (h.platformAdmin ? { ok: true, via: 'platform' } : { ok: false, status: 403 }), writeRefusal }
})
vi.mock('@/lib/tenancy/request-tenant', () => ({
  requestTenant: async () => (h.tenantKind === 'stellr' ? { kind: 'stellr' } : { kind: 'tenant', tenantId: TENANT, tenantSlug: 'sup-canary' }),
}))
vi.mock('@/lib/audit/platform', () => ({ auditEnabled: () => h.audit }))
vi.mock('@/lib/audit/route', () => ({ auditMutation }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => (h.rpcCalls.push([name, args]), h.rpc),
    from: () => {
      const state = { values: {} as Record<string, unknown>, filters: [] as [string, unknown][] }
      const q = {
        update: (values: Record<string, unknown>) => ((state.values = values), q),
        eq: (col: string, v: unknown) => (state.filters.push([col, v]), q),
        then: (ok: (v: unknown) => unknown) => (h.updates.push(state), Promise.resolve({ data: null, error: null }).then(ok)),
      }
      return q
    },
  }),
}))

const { POST, PATCH } = await import('./route')
const { encodeSupportTicket, decodeSupportTicket, SUPPORT_SESSION_COOKIE } = await import('@/lib/authz/support-session')

const call = (fn: (r: Request) => Promise<Response>, method: string, body: unknown, cookie?: string) =>
  fn(
    new Request('https://www.example.test/api/admin/support/break-glass', {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )
const open = (body: unknown = { consentId: CONSENT, reason: REASON }, cookie?: string) => call(POST, 'POST', body, cookie)
const renew = (body: unknown = { reason: 'Still fixing the stuck registration' }, cookie?: string) => call(PATCH, 'PATCH', body, cookie)
const bgTicket = (over: Record<string, unknown> = {}) =>
  encodeSupportTicket({ v: 1, sid: SID, tid: TENANT, uid: ADMIN, csid: 'sess_abc123', mode: 'break_glass', exp: Date.now() + 10 * 60_000, ...over } as never)
const refusal = (hint: string) => ({ data: null, error: { message: 'refused', code: '42501', hint } })

beforeEach(() => {
  vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
  vi.stubEnv('SUPPORT_SESSION_SECRET', SECRET)
  Object.assign(h, { platformAdmin: true, tenantKind: 'stellr', stepUpFresh: true, audit: true, auditOk: true })
  h.clerk = { userId: ADMIN, sessionId: 'sess_abc123' }
  h.jar.clear()
  h.rpc = { data: [{ session_id: SID, tenant_id: TENANT, ends_at: new Date(Date.now() + 30 * 60_000).toISOString() }], error: null }
  h.rpcCalls = []
  h.updates = []
  auditMutation.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('the doors', () => {
  it('off: 404, and nothing is called', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', '')
    expect((await open()).status).toBe(404)
    expect((await renew()).status).toBe(404)
    expect(h.rpcCalls).toEqual([])
  })
  it('a tenant host: 404 (S6-Q7)', async () => {
    h.tenantKind = 'tenant'
    expect((await open()).status).toBe(404)
  })
  it('not a platform admin: 403', async () => {
    h.platformAdmin = false
    expect((await open()).status).toBe(403)
    expect(h.rpcCalls).toEqual([])
  })
  it('from inside a read session: 403 support_read_only', async () => {
    const read = encodeSupportTicket({ v: 1, sid: SID, tid: TENANT, uid: ADMIN, csid: 'sess_abc123', mode: 'read', exp: Date.now() + 60_000 })
    const res = await open(undefined, `${SUPPORT_SESSION_COOKIE}=${read}`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'support_read_only' })
  })
  it('with the audit log off: 503, and nothing opens', async () => {
    h.audit = false
    expect((await open()).status).toBe(503)
    expect(h.rpcCalls).toEqual([])
  })
})

describe('the four refusals the S6 gate names', () => {
  it('no tenant consent: 403 break_glass_no_consent, and no cookie', async () => {
    h.rpc = refusal('break_glass_no_consent')
    const res = await open()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'break_glass_no_consent' })
    expect(h.jar.has(SUPPORT_SESSION_COOKIE)).toBe(false)
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('no reason: 400 break_glass_reason, before the database is asked', async () => {
    for (const reason of [undefined, '', 'too short', '   padded but short   ', 'x'.repeat(501)]) {
      const res = await open({ consentId: CONSENT, reason })
      expect(res.status, String(reason)).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'break_glass_reason' })
    }
    expect(h.rpcCalls).toEqual([])
  })

  it('no step-up in the last 5 minutes: Clerk\'s reverification 403, on open and on renew, whatever ADMIN_STEP_UP_ENFORCE says', async () => {
    vi.stubEnv('ADMIN_STEP_UP_ENFORCE', '')
    h.stepUpFresh = false
    for (const res of [await open(), await renew(undefined, `${SUPPORT_SESSION_COOKIE}=${bgTicket()}`)]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ clerk_error: { reason: 'reverification-error' } })
    }
    expect(h.rpcCalls).toEqual([])
  })

  it('past the time limit: renew refuses an ended session, and the ended cookie refuses before that', async () => {
    const ended = await renew(undefined, `${SUPPORT_SESSION_COOKIE}=${bgTicket({ exp: Date.now() - 1 })}`)
    expect(ended.status).toBe(403)
    expect(await ended.json()).toMatchObject({ code: 'support_session_ended' })
    h.rpc = refusal('break_glass_ended')
    const closed = await renew(undefined, `${SUPPORT_SESSION_COOKIE}=${bgTicket()}`)
    expect(closed.status).toBe(409)
    expect(await closed.json()).toMatchObject({ code: 'break_glass_ended' })
  })
})

describe('opening', () => {
  it('passes the consent, the caller and the trimmed reason to the database', async () => {
    await open({ consentId: CONSENT.toUpperCase(), reason: `  ${REASON}  ` })
    expect(h.rpcCalls).toEqual([['support_break_glass_open', { p_consent_id: CONSENT, p_admin: ADMIN, p_reason: REASON }]])
  })

  it('opens: 201, audited on the tenant chain, and a break_glass cookie ending with the session', async () => {
    const res = await open()
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ sessionId: SID, tenantId: TENANT, mode: 'break_glass' })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'support.break_glass.open', tenant: { tenantId: TENANT }, target: { table: 'support_sessions', id: SID } }),
      { afterResponse: false },
    )
    const ticket = decodeSupportTicket(h.jar.get(SUPPORT_SESSION_COOKIE)!.value)
    expect(ticket).toMatchObject({ sid: SID, tid: TENANT, uid: ADMIN, mode: 'break_glass' })
    expect(h.jar.get(SUPPORT_SESSION_COOKIE)!.opts).toMatchObject({ httpOnly: true, sameSite: 'strict' })
  })

  it('a live session already open: 409 support_session_open', async () => {
    h.rpc = refusal('support_session_open')
    expect((await open()).status).toBe(409)
  })

  it('an audit write that fails: the session is closed again, 503, and no cookie', async () => {
    h.auditOk = false
    expect((await open()).status).toBe(503)
    expect(h.updates[0].filters).toEqual([['id', SID]])
    expect(h.updates[0].values).toHaveProperty('closed_at')
    expect(h.jar.has(SUPPORT_SESSION_COOKIE)).toBe(false)
  })

  it('any other database failure: 503', async () => {
    h.rpc = { data: null, error: { message: 'boom' } }
    expect((await open()).status).toBe(503)
  })
})

describe('renewing', () => {
  const later = () => new Date(Date.now() + 40 * 60_000).toISOString()

  it('renews once, audited, and re-issues the cookie with the new end', async () => {
    const endsAt = later()
    h.rpc = { data: endsAt, error: null }
    const res = await renew(undefined, `${SUPPORT_SESSION_COOKIE}=${bgTicket()}`)
    expect(res.status).toBe(200)
    expect(h.rpcCalls).toEqual([['support_break_glass_renew', { p_session_id: SID, p_admin: ADMIN, p_reason: 'Still fixing the stuck registration' }]])
    expect(auditMutation).toHaveBeenCalledWith(expect.objectContaining({ action: 'support.break_glass.renew', tenant: { tenantId: TENANT } }), { afterResponse: false })
    expect(decodeSupportTicket(h.jar.get(SUPPORT_SESSION_COOKIE)!.value)?.exp).toBe(Date.parse(endsAt))
  })

  it('a second renewal: 409 break_glass_renewed', async () => {
    h.rpc = refusal('break_glass_renewed')
    const res = await renew(undefined, `${SUPPORT_SESSION_COOKIE}=${bgTicket()}`)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'break_glass_renewed' })
  })

  it('no break-glass cookie, a read cookie, or someone else\'s: 409 break_glass_ended, and the database is not asked', async () => {
    for (const cookie of [undefined, `${SUPPORT_SESSION_COOKIE}=${bgTicket({ uid: 'user_someoneElse' })}`, `${SUPPORT_SESSION_COOKIE}=${bgTicket({ csid: 'sess_other' })}`]) {
      expect((await renew(undefined, cookie)).status).toBe(409)
    }
    expect(h.rpcCalls).toEqual([])
  })

  it('a renewal reason under 20 characters: 400', async () => {
    expect((await renew({ reason: 'more time' }, `${SUPPORT_SESSION_COOKIE}=${bgTicket()}`)).status).toBe(400)
  })

  it('a renewal the audit chain cannot record: the session is closed and the cookie cleared', async () => {
    h.rpc = { data: later(), error: null }
    h.auditOk = false
    expect((await renew(undefined, `${SUPPORT_SESSION_COOKIE}=${bgTicket()}`)).status).toBe(503)
    expect(h.updates[0].values).toHaveProperty('closed_at')
    expect(h.jar.get(SUPPORT_SESSION_COOKIE)!.value).toBe('')
  })
})
