// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S6-CON-b: set a per-tenant switch. Platform host, platform admin, strict step-up,
// never the owner, known flags only, on the tenant's audit chain or undone.

const ADMIN = 'user_platformAdmin1'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'

const h = vi.hoisted(() => ({
  userId: 'user_platformAdmin1' as string | null,
  platformAdmin: true,
  host: 'stellr' as 'stellr' | 'tenant',
  stepUpFresh: true,
  audit: true,
  auditOk: true,
  tenant: { id: '5e550000-0000-4000-8000-0000000000b2', is_platform_owner: false } as Record<string, unknown> | null,
  before: null as { enabled: boolean } | null,
  writeError: null as unknown,
  calls: [] as { table: string; op: string; values?: unknown; filters: [string, unknown][] }[],
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
    from: (table: string) => {
      const call = { table, op: 'select', values: undefined as unknown, filters: [] as [string, unknown][] }
      const q = {
        select: () => q,
        upsert: (v: unknown) => ((call.op = 'upsert'), (call.values = v), q),
        update: (v: unknown) => ((call.op = 'update'), (call.values = v), q),
        delete: () => ((call.op = 'delete'), q),
        eq: (c: string, v: unknown) => (call.filters.push([c, v]), q),
        maybeSingle: async () => (table === 'tenants' ? { data: h.tenant, error: null } : { data: h.before, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          h.calls.push(call)
          return Promise.resolve(call.op === 'upsert' && h.writeError ? { data: null, error: h.writeError } : { data: null, error: null }).then(ok)
        },
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')

const set = (body: unknown = { flag: 'break_glass_allowed', enabled: false }, id = TENANT) =>
  POST(new Request(`https://www.example.test/api/admin/platform/tenants/${id}/flags`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  Object.assign(h, { userId: ADMIN, platformAdmin: true, host: 'stellr', stepUpFresh: true, audit: true, auditOk: true, writeError: null, before: null })
  h.tenant = { id: TENANT, is_platform_owner: false }
  h.calls = []
  auditMutation.mockClear()
})

describe('the doors', () => {
  it('a tenant host: 404', async () => {
    h.host = 'tenant'
    expect((await set()).status).toBe(404)
  })
  it('not a platform admin: 403, nothing written', async () => {
    h.platformAdmin = false
    expect((await set()).status).toBe(403)
    expect(h.calls).toEqual([])
  })
  it('no recent step-up: Clerk\'s reverification 403', async () => {
    h.stepUpFresh = false
    expect((await set()).status).toBe(403)
    expect(h.calls).toEqual([])
  })
  it('the audit log off: 503 before anything changes', async () => {
    h.audit = false
    expect((await set()).status).toBe(503)
    expect(h.calls).toEqual([])
  })
  it('an unknown flag or a non-boolean: 400', async () => {
    expect((await set({ flag: 'store_enabled', enabled: true })).status).toBe(400)
    expect((await set({ flag: 'break_glass_allowed', enabled: 'no' })).status).toBe(400)
    expect(h.calls).toEqual([])
  })
  it('never the platform owner; an unknown tenant is 404', async () => {
    h.tenant = { id: TENANT, is_platform_owner: true }
    const res = await set()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'platform_owner' })
    h.tenant = null
    expect((await set()).status).toBe(404)
    expect(h.calls.filter((c) => c.op !== 'select')).toEqual([])
  })
})

describe('setting a switch', () => {
  it('writes the row and audits it on the tenant chain, with the old value', async () => {
    const res = await set()
    expect(res.status).toBe(200)
    const write = h.calls.find((c) => c.op === 'upsert')!
    expect(write.values).toMatchObject({ tenant_id: TENANT, flag: 'break_glass_allowed', enabled: false, updated_by: ADMIN })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform.tenant_flag.set',
        tenant: { tenantId: TENANT },
        metadata: { flag: 'break_glass_allowed', enabled: false, previous: true },
      }),
      { afterResponse: false },
    )
  })

  it('a failed write: 503, nothing audited', async () => {
    h.writeError = { message: 'boom' }
    expect((await set()).status).toBe(503)
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('an audit write that fails with no row before: the new row is deleted', async () => {
    h.auditOk = false
    expect((await set()).status).toBe(503)
    expect(h.calls.at(-1)).toMatchObject({ table: 'tenant_feature_flags', op: 'delete', filters: [['tenant_id', TENANT], ['flag', 'break_glass_allowed']] })
  })

  it('an audit write that fails over an existing row: the old value is put back', async () => {
    h.auditOk = false
    h.before = { enabled: true }
    expect((await set()).status).toBe(503)
    expect(h.calls.at(-1)).toMatchObject({ op: 'update', values: { enabled: true } })
  })
})
