// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S6-CON: suspend or resume a tenant. Platform host, platform admin, strict step-up,
// never the owner, only active <-> suspended, on the tenant's audit chain or undone.

const ADMIN = 'user_platformAdmin1'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const REASON = 'Unpaid invoice past 60 days, per the contract'

const h = vi.hoisted(() => ({
  userId: 'user_platformAdmin1' as string | null,
  platformAdmin: true,
  host: 'stellr' as 'stellr' | 'tenant',
  stepUpFresh: true,
  audit: true,
  auditOk: true,
  tenant: { id: '5e550000-0000-4000-8000-0000000000b2', status: 'active', is_platform_owner: false } as Record<string, unknown> | null,
  updateError: null as unknown,
  updated: 1,
  updates: [] as { values: Record<string, unknown>; filters: [string, unknown][] }[],
}))
const auditMutation = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => (h.auditOk ? { ok: true, id: 'evt' } : { ok: false, error: 'down' })))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: h.userId, has: () => h.stepUpFresh }),
  reverificationErrorResponse: () => new Response(JSON.stringify({ clerk_error: { reason: 'reverification-error' } }), { status: 403 }),
}))
vi.mock('@/lib/authz', async () => {
  const { writeRefusal } = await import('@/lib/authz/writable')
  return { assertPlatformAdmin: async () => (h.platformAdmin ? { ok: true } : { ok: false, status: 403 }), writeRefusal }
})
vi.mock('@/lib/tenancy/request-tenant', () => ({
  requestTenant: async () => (h.host === 'stellr' ? { kind: 'stellr' } : { kind: 'tenant', tenantId: TENANT, tenantSlug: 'b' }),
}))
vi.mock('@/lib/audit/platform', () => ({ auditEnabled: () => h.audit }))
vi.mock('@/lib/audit/route', () => ({ auditMutation }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const state = { op: 'select', values: {} as Record<string, unknown>, filters: [] as [string, unknown][] }
      const q = {
        select: () => q,
        update: (v: Record<string, unknown>) => ((state.op = 'update'), (state.values = v), q),
        eq: (c: string, v: unknown) => (state.filters.push([c, v]), q),
        maybeSingle: async () => ({ data: h.tenant, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          h.updates.push({ values: state.values, filters: state.filters })
          const first = h.updates.length === 1
          return Promise.resolve(
            first && h.updateError ? { data: null, error: h.updateError } : { data: Array.from({ length: first ? h.updated : 1 }, () => ({ id: TENANT })), error: null },
          ).then(ok)
        },
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')

const change = (body: unknown = { status: 'suspended', reason: REASON }, id = TENANT) =>
  POST(new Request(`https://www.example.test/api/admin/platform/tenants/${id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  Object.assign(h, { userId: ADMIN, platformAdmin: true, host: 'stellr', stepUpFresh: true, audit: true, auditOk: true, updateError: null, updated: 1 })
  h.tenant = { id: TENANT, status: 'active', is_platform_owner: false }
  h.updates = []
  auditMutation.mockClear()
})

describe('the doors', () => {
  it('a tenant host: 404', async () => {
    h.host = 'tenant'
    expect((await change()).status).toBe(404)
  })
  it('not a platform admin: 403', async () => {
    h.platformAdmin = false
    expect((await change()).status).toBe(403)
    expect(h.updates).toEqual([])
  })
  it('no recent step-up, whatever ADMIN_STEP_UP_ENFORCE says: Clerk\'s reverification 403', async () => {
    h.stepUpFresh = false
    const res = await change()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ clerk_error: { reason: 'reverification-error' } })
    expect(h.updates).toEqual([])
  })
  it('the audit log off: 503 before anything changes', async () => {
    h.audit = false
    expect((await change()).status).toBe(503)
    expect(h.updates).toEqual([])
  })
  it('a bad status or a short reason: 400', async () => {
    expect((await change({ status: 'archived', reason: REASON })).status).toBe(400)
    expect((await change({ status: 'suspended', reason: 'because' })).status).toBe(400)
    expect(h.updates).toEqual([])
  })
})

describe('changing status', () => {
  it('suspends an active tenant, only from active, audited on its chain without the reason', async () => {
    const res = await change()
    expect(res.status).toBe(200)
    expect(h.updates[0]).toEqual({ values: { status: 'suspended' }, filters: [['id', TENANT], ['status', 'active']] })
    expect(auditMutation).toHaveBeenCalledWith(
      { action: 'platform.tenant.suspend', actor: { userId: ADMIN }, tenant: { tenantId: TENANT }, target: { table: 'tenants', id: TENANT }, reason: 'platform_console', metadata: { from: 'active', to: 'suspended' } },
      { afterResponse: false },
    )
  })

  it('resumes a suspended tenant', async () => {
    h.tenant = { id: TENANT, status: 'suspended', is_platform_owner: false }
    expect((await change({ status: 'active', reason: REASON })).status).toBe(200)
    expect(auditMutation).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.tenant.resume' }), { afterResponse: false })
  })

  it('never the platform owner', async () => {
    h.tenant = { id: TENANT, status: 'active', is_platform_owner: true }
    const res = await change()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'platform_owner' })
    expect(h.updates).toEqual([])
  })

  it('not from provisioning or archived, and not to the status it has: 409', async () => {
    for (const status of ['provisioning', 'archived', 'suspended']) {
      h.tenant = { id: TENANT, status, is_platform_owner: false }
      expect((await change()).status, status).toBe(409)
    }
    expect(h.updates).toEqual([])
  })

  it('an unknown tenant: 404', async () => {
    h.tenant = null
    expect((await change()).status).toBe(404)
  })

  it('the readiness lock refusing a resume: 409 tenancy_not_ready', async () => {
    h.tenant = { id: TENANT, status: 'suspended', is_platform_owner: false }
    h.updateError = { code: '55000', message: 'tenancy: not ready' }
    const res = await change({ status: 'active', reason: REASON })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'tenancy_not_ready' })
  })

  it('a race (no row changed): 409', async () => {
    h.updated = 0
    expect((await change()).status).toBe(409)
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('an audit write that fails: the change is undone, 503', async () => {
    h.auditOk = false
    expect((await change()).status).toBe(503)
    expect(h.updates[1]).toEqual({ values: { status: 'active' }, filters: [['id', TENANT], ['status', 'suspended']] })
  })
})
