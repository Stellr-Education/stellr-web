// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S6-SUP: opening and closing a support session. Off: 404. A tenant host: 404 (S6-Q7).
// Only a platform admin opens one, never for the platform owner, never while a read
// session is open, and never unless the TENANT's audit chain records it.

const ADMIN = 'user_platformAdmin1'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const OWNER = '00000000-0000-4000-8000-000000000001'
const SID = '5e550000-0000-4000-8000-00000000000a'
const REASON = 'Ticket 4521: the roster export is missing rows'

const h = vi.hoisted(() => ({
  clerk: { userId: 'user_platformAdmin1' as string | null, sessionId: 'sess_abc123' as string | null },
  platformAdmin: true,
  tenantKind: 'stellr' as 'stellr' | 'tenant' | 'throw',
  audit: true,
  auditOk: true,
  jar: new Map<string, { value: string; opts: Record<string, unknown> }>(),
  adminRow: true,
  tenantRow: { id: '5e550000-0000-4000-8000-0000000000b2', display_name: 'Sup Canary', is_platform_owner: false } as Record<string, unknown> | null,
  openRows: [] as { id: string; ends_at: string }[],
  inserted: [] as Record<string, unknown>[],
  updates: [] as { values: Record<string, unknown>; filters: [string, unknown][] }[],
  closedRows: [] as { id: string; tenant_id: string }[],
}))

const auditMutation = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => (h.auditOk ? { ok: true, id: 'evt' } : { ok: false, error: 'down' })))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => h.clerk }))
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
vi.mock('@/lib/authz/step-up', () => ({ requireStepUp: async () => null }))
vi.mock('@/lib/tenancy/request-tenant', () => ({
  requestTenant: async () => {
    if (h.tenantKind === 'throw') throw new Error('bad headers')
    return h.tenantKind === 'stellr' ? { kind: 'stellr' } : { kind: 'tenant', tenantId: TENANT, tenantSlug: 'sup-canary' }
  },
}))
vi.mock('@/lib/audit/platform', () => ({ auditEnabled: () => h.audit }))
vi.mock('@/lib/audit/route', () => ({ auditMutation }))

/** A chainable stand-in for the few supabase-js calls the route makes. */
function query(table: string) {
  const state: { op: string; values?: Record<string, unknown>; filters: [string, unknown][] } = { op: 'select', filters: [] }
  const result = (): { data: unknown; error: unknown } => {
    if (table === 'platform_admins') return { data: h.adminRow ? { clerk_user_id: ADMIN } : null, error: null }
    if (table === 'tenants') return { data: h.tenantRow, error: null }
    if (state.op === 'insert') {
      h.inserted.push(state.values!)
      return { data: { id: SID }, error: null }
    }
    if (state.op === 'update') {
      h.updates.push({ values: state.values!, filters: state.filters })
      return { data: h.closedRows, error: null }
    }
    return { data: h.openRows, error: null }
  }
  const q = {
    select: () => q,
    insert: (values: Record<string, unknown>) => ((state.op = 'insert'), (state.values = values), q),
    update: (values: Record<string, unknown>) => ((state.op = 'update'), (state.values = values), q),
    eq: (col: string, v: unknown) => (state.filters.push([col, v]), q),
    is: (col: string, v: unknown) => (state.filters.push([col, v]), q),
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
  }
  return q
}
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: (t: string) => query(t) }) }))

const { POST, DELETE } = await import('./route')
const { encodeSupportTicket, SUPPORT_SESSION_COOKIE } = await import('@/lib/authz/support-session')

const open = (body: unknown = { tenantId: TENANT, reason: REASON }, cookie?: string) =>
  POST(
    new Request('https://www.example.test/api/admin/support/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
  vi.stubEnv('SUPPORT_SESSION_SECRET', 'support-secret-for-tests-only-0123456789')
  h.clerk = { userId: ADMIN, sessionId: 'sess_abc123' }
  h.platformAdmin = true
  h.tenantKind = 'stellr'
  h.audit = true
  h.auditOk = true
  h.jar = new Map()
  h.adminRow = true
  h.tenantRow = { id: TENANT, display_name: 'Sup Canary', is_platform_owner: false }
  h.openRows = []
  h.inserted = []
  h.updates = []
  h.closedRows = []
  auditMutation.mockClear()
})

describe('POST: open', () => {
  it('flag off: 404, and nothing is read', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', undefined)
    expect((await open()).status).toBe(404)
    expect(h.inserted).toEqual([])
  })

  it.each(['tenant', 'throw'] as const)('a tenant host (%s): 404', async (kind) => {
    h.tenantKind = kind
    expect((await open()).status).toBe(404)
    expect(h.inserted).toEqual([])
  })

  it('not a platform admin: 403', async () => {
    h.platformAdmin = false
    expect((await open()).status).toBe(403)
    expect(h.inserted).toEqual([])
  })

  it('a Clerk admin with no platform_admins row: 403', async () => {
    h.adminRow = false
    expect((await open()).status).toBe(403)
    expect(h.inserted).toEqual([])
  })

  it('opens a read session, records it on the TENANT chain, and sets the bound cookie', async () => {
    const res = await open()
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ sessionId: SID, tenantId: TENANT, tenantName: 'Sup Canary', mode: 'read' })
    expect(h.inserted).toEqual([expect.objectContaining({ platform_admin_user_id: ADMIN, tenant_id: TENANT, reason: REASON, mode: 'read' })])
    const row = h.inserted[0] as { opened_at: string; ends_at: string }
    expect(Date.parse(row.ends_at) - Date.parse(row.opened_at)).toBe(30 * 60_000)
    expect(auditMutation).toHaveBeenCalledOnce()
    expect(auditMutation.mock.calls[0][0]).toEqual({
      action: 'support.session.open',
      actor: { userId: ADMIN },
      tenant: { tenantId: TENANT },
      target: { table: 'support_sessions', id: SID },
      reason: 'support_session',
      metadata: { mode: 'read', minutes: 30 },
    })
    expect(JSON.stringify(auditMutation.mock.calls[0][0])).not.toContain('4521')
    const cookie = h.jar.get(SUPPORT_SESSION_COOKIE)!
    expect(cookie.opts).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/', maxAge: 30 * 60 })
    const payload = JSON.parse(Buffer.from(cookie.value.split('.')[0], 'base64url').toString())
    expect(payload).toMatchObject({ sid: SID, tid: TENANT, uid: ADMIN, csid: 'sess_abc123', mode: 'read' })
  })

  it('the audit chain off, or a failed audit write: 503, and the row is closed again', async () => {
    h.audit = false
    expect((await open()).status).toBe(503)
    expect(h.inserted).toEqual([])
    h.audit = true
    h.auditOk = false
    expect((await open()).status).toBe(503)
    expect(h.updates.at(-1)?.values).toHaveProperty('closed_at')
    expect(h.jar.has(SUPPORT_SESSION_COOKIE)).toBe(false)
  })

  it('the platform-owner tenant: 403 support_owner_tenant', async () => {
    h.tenantRow = { id: OWNER, display_name: 'Stellr', is_platform_owner: true }
    const res = await open({ tenantId: OWNER, reason: REASON })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('support_owner_tenant')
    expect(h.inserted).toEqual([])
  })

  it.each([
    [{ tenantId: 'nope', reason: REASON }],
    [{ tenantId: TENANT, reason: 'too short' }],
    [{ tenantId: TENANT, reason: REASON, minutes: 61 }],
    [{ tenantId: TENANT, reason: REASON, minutes: 0 }],
    [{ tenantId: TENANT, reason: REASON, mode: 'break_glass' }],
  ])('a bad body is 400: %j', async (body) => {
    expect((await open(body)).status).toBe(400)
    expect(h.inserted).toEqual([])
  })

  it('an unexpired open session: 409', async () => {
    h.openRows = [{ id: 'other', ends_at: new Date(Date.now() + 60_000).toISOString() }]
    expect((await open()).status).toBe(409)
    expect(h.inserted).toEqual([])
  })

  it('while a read session cookie is on the request: 403 support_read_only', async () => {
    const raw = encodeSupportTicket({ v: 1, sid: SID, tid: TENANT, uid: ADMIN, csid: 'sess_abc123', mode: 'read', exp: Date.now() + 60_000 })
    const res = await open(undefined, `${SUPPORT_SESSION_COOKIE}=${raw}`)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('support_read_only')
  })
})

describe('DELETE: close', () => {
  const live = () =>
    h.jar.set(SUPPORT_SESSION_COOKIE, {
      value: encodeSupportTicket({ v: 1, sid: SID, tid: TENANT, uid: ADMIN, csid: 'sess_abc123', mode: 'read', exp: Date.now() + 60_000 }),
      opts: {},
    })

  it('flag off: 404', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', undefined)
    expect((await DELETE()).status).toBe(404)
  })

  it('a tenant host: 404', async () => {
    h.tenantKind = 'tenant'
    expect((await DELETE()).status).toBe(404)
  })

  it('closes the caller’s own session, clears the cookie, and records it on the tenant chain', async () => {
    live()
    h.closedRows = [{ id: SID, tenant_id: TENANT }]
    const res = await DELETE()
    expect(await res.json()).toEqual({ closed: true })
    expect(h.updates[0].filters).toEqual([
      ['id', SID],
      ['platform_admin_user_id', ADMIN],
      ['closed_at', null],
    ])
    expect(h.jar.get(SUPPORT_SESSION_COOKIE)).toMatchObject({ value: '', opts: { maxAge: 0 } })
    expect(auditMutation.mock.calls[0][0]).toMatchObject({ action: 'support.session.close', tenant: { tenantId: TENANT }, metadata: { closed: true } })
  })

  it('a cookie from another admin closes nothing', async () => {
    live()
    h.clerk = { userId: 'user_someoneElse', sessionId: 'sess_x' }
    expect(await (await DELETE()).json()).toEqual({ closed: false })
    expect(h.updates).toEqual([])
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('no cookie: clears it anyway, closes nothing', async () => {
    expect(await (await DELETE()).json()).toEqual({ closed: false })
    expect(h.updates).toEqual([])
  })
})
