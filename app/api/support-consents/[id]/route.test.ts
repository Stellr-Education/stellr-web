// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S6-BG: a tenant admin answers a break-glass request (S6-Q4). Only on the tenant's own
// host, only past requireTenantCrew(tenant_admin), and the database decides the rest:
// the request must be this tenant's, the caller a tenant_admin of it, and never a
// platform admin. An approval the audit chain cannot record is withdrawn.

const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const CONSENT = 'bc000000-0000-4000-8000-0000000000c1'
const TENANT_ADMIN = 'user_tenantAdmin1'

const h = vi.hoisted(() => ({
  userId: 'user_tenantAdmin1' as string | null,
  host: 'tenant' as 'tenant' | 'stellr',
  crewOk: true,
  audit: true,
  auditOk: true,
  rpc: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as [string, Record<string, unknown>][],
}))
const auditMutation = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => (h.auditOk ? { ok: true, id: 'evt' } : { ok: false, error: 'down' })))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/authz', () => ({
  api: {
    requireTenantCrew: vi.fn(async (tenantId: string, roles: string[]) =>
      h.crewOk && tenantId === TENANT && roles.join() === 'tenant_admin'
        ? { ok: true, value: { ok: true } }
        : { ok: false, deny: Response.json({ error: 'Forbidden' }, { status: 403 }) },
    ),
  },
}))
vi.mock('@/lib/tenancy/request-tenant', () => ({
  requestTenant: async () => (h.host === 'tenant' ? { kind: 'tenant', tenantId: TENANT, tenantSlug: 'sup-canary' } : { kind: 'stellr' }),
}))
vi.mock('@/lib/audit/platform', () => ({ auditEnabled: () => h.audit }))
vi.mock('@/lib/audit/route', () => ({ auditMutation }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push([name, args])
      return name === 'support_consent_decide' ? h.rpc : { data: true, error: null }
    },
  }),
}))

const { POST } = await import('./route')

const answer = (decision: unknown = 'approve', id = CONSENT) =>
  POST(
    new Request(`https://sup-canary.example.test/api/support-consents/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    }),
    { params: Promise.resolve({ id }) },
  )
const refusal = (hint: string) => ({ data: null, error: { message: 'refused', hint } })

beforeEach(() => {
  vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
  Object.assign(h, { userId: TENANT_ADMIN, host: 'tenant', crewOk: true, audit: true, auditOk: true })
  h.rpc = { data: TENANT, error: null }
  h.rpcCalls = []
  auditMutation.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('the doors', () => {
  it('off, or the platform host: 404, and nothing is called', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', '')
    expect((await answer()).status).toBe(404)
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    h.host = 'stellr'
    expect((await answer()).status).toBe(404)
    expect(h.rpcCalls).toEqual([])
  })
  it('signed out: 401', async () => {
    h.userId = null
    expect((await answer()).status).toBe(401)
  })
  it('not a tenant admin of the host tenant: the crew guard\'s 403', async () => {
    h.crewOk = false
    expect((await answer()).status).toBe(403)
    expect(h.rpcCalls).toEqual([])
  })
  it('the audit log off: 503, and nothing is decided', async () => {
    h.audit = false
    expect((await answer()).status).toBe(503)
    expect(h.rpcCalls).toEqual([])
  })
  it('a malformed id: 404; a bad decision: 400', async () => {
    expect((await answer('approve', 'not-a-uuid')).status).toBe(404)
    expect((await answer('maybe')).status).toBe(400)
    expect(h.rpcCalls).toEqual([])
  })
})

describe('deciding', () => {
  it('approves, passing the HOST tenant, never one from the request', async () => {
    const res = await answer('approve', CONSENT.toUpperCase())
    expect(res.status).toBe(200)
    expect(h.rpcCalls).toEqual([['support_consent_decide', { p_consent_id: CONSENT, p_tenant_id: TENANT, p_approver: TENANT_ADMIN, p_approve: true }]])
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'support.consent.approve', tenant: { tenantId: TENANT }, target: { table: 'support_consents', id: CONSENT } }),
      { afterResponse: false },
    )
  })

  it('declines', async () => {
    expect((await answer('decline')).status).toBe(200)
    expect(h.rpcCalls[0][1]).toMatchObject({ p_approve: false })
    expect(auditMutation).toHaveBeenCalledWith(expect.objectContaining({ action: 'support.consent.decline' }), { afterResponse: false })
  })

  it.each([
    ['consent_not_found', 404],
    ['consent_not_tenant_admin', 403],
    ['consent_platform_admin', 403],
    ['consent_decided', 409],
    ['consent_lapsed', 409],
  ])('the database refuses %s: %i, nothing audited', async (hint, status) => {
    h.rpc = refusal(hint)
    const res = await answer()
    expect(res.status).toBe(status)
    expect(await res.json()).toMatchObject({ code: hint })
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('any other failure: 503', async () => {
    h.rpc = { data: null, error: { message: 'boom' } }
    expect((await answer()).status).toBe(503)
  })

  it('an approval the audit chain cannot record is withdrawn: 503', async () => {
    h.auditOk = false
    expect((await answer()).status).toBe(503)
    expect(h.rpcCalls[1]).toEqual(['support_consent_withdraw', { p_consent_id: CONSENT, p_tenant_id: TENANT }])
  })
})
