// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S6-BG: a platform admin asks a tenant for break-glass. Platform host only, platform
// admins only, never the platform owner, a reason of 20 to 500 characters, and on the
// tenant's audit chain or withdrawn. Allowed from inside a read session.

const ADMIN = 'user_platformAdmin1'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const OWNER = '00000000-0000-4000-8000-000000000001'
const CONSENT = 'bc000000-0000-4000-8000-0000000000c1'
const REASON = 'Ticket 4521: a registration is stuck in pending'

const h = vi.hoisted(() => ({
  userId: 'user_platformAdmin1' as string | null,
  platformAdmin: true,
  host: 'stellr' as 'stellr' | 'tenant',
  audit: true,
  auditOk: true,
  adminRow: true,
  tenantRow: { id: '5e550000-0000-4000-8000-0000000000b2', is_platform_owner: false } as Record<string, unknown> | null,
  inserted: [] as Record<string, unknown>[],
  updates: [] as { values: Record<string, unknown>; filters: [string, unknown][] }[],
}))
const auditMutation = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => (h.auditOk ? { ok: true, id: 'evt' } : { ok: false, error: 'down' })))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/authz', () => ({ assertPlatformAdmin: async () => (h.platformAdmin ? { ok: true } : { ok: false, status: 403 }) }))
vi.mock('@/lib/tenancy/request-tenant', () => ({
  requestTenant: async () => (h.host === 'stellr' ? { kind: 'stellr' } : { kind: 'tenant', tenantId: TENANT, tenantSlug: 'sup-canary' }),
}))
vi.mock('@/lib/audit/platform', () => ({ auditEnabled: () => h.audit }))
vi.mock('@/lib/audit/route', () => ({ auditMutation }))

function query(table: string) {
  const state = { op: 'select', values: {} as Record<string, unknown>, filters: [] as [string, unknown][] }
  const result = () => {
    if (table === 'platform_admins') return { data: h.adminRow ? { clerk_user_id: ADMIN } : null, error: null }
    if (table === 'tenants') return { data: h.tenantRow, error: null }
    if (state.op === 'insert') return (h.inserted.push(state.values), { data: { id: CONSENT }, error: null })
    return (h.updates.push({ values: state.values, filters: state.filters }), { data: null, error: null })
  }
  const q = {
    select: () => q,
    insert: (v: Record<string, unknown>) => ((state.op = 'insert'), (state.values = v), q),
    update: (v: Record<string, unknown>) => ((state.op = 'update'), (state.values = v), q),
    eq: (c: string, v: unknown) => (state.filters.push([c, v]), q),
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
  }
  return q
}
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: (t: string) => query(t) }) }))

const { POST } = await import('./route')

const ask = (body: unknown = { tenantId: TENANT, reason: REASON }) =>
  POST(new Request('https://www.example.test/api/admin/support/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
  Object.assign(h, { userId: ADMIN, platformAdmin: true, host: 'stellr', audit: true, auditOk: true, adminRow: true })
  h.tenantRow = { id: TENANT, is_platform_owner: false }
  h.inserted = []
  h.updates = []
  auditMutation.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

it('off, or a tenant host: 404', async () => {
  vi.stubEnv('SUPPORT_MODE_ENABLED', '')
  expect((await ask()).status).toBe(404)
  vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
  h.host = 'tenant'
  expect((await ask()).status).toBe(404)
  expect(h.inserted).toEqual([])
})

it('not a platform admin, or no platform_admins row: 403', async () => {
  h.platformAdmin = false
  expect((await ask()).status).toBe(403)
  h.platformAdmin = true
  h.adminRow = false
  expect((await ask()).status).toBe(403)
  expect(h.inserted).toEqual([])
})

it('a bad tenant id, or a reason outside 20 to 500 characters: 400', async () => {
  expect((await ask({ tenantId: 'x', reason: REASON })).status).toBe(400)
  for (const reason of [undefined, 'short', 'x'.repeat(501)]) expect((await ask({ tenantId: TENANT, reason })).status).toBe(400)
  expect(h.inserted).toEqual([])
})

it('the platform owner: 403 support_owner_tenant; an unknown tenant: 404', async () => {
  h.tenantRow = { id: OWNER, is_platform_owner: true }
  const res = await ask({ tenantId: OWNER, reason: REASON })
  expect(res.status).toBe(403)
  expect(await res.json()).toMatchObject({ code: 'support_owner_tenant' })
  h.tenantRow = null
  expect((await ask()).status).toBe(404)
  expect(h.inserted).toEqual([])
})

it('records a request that lapses in 24 hours, on the tenant chain: 201', async () => {
  const res = await ask({ tenantId: TENANT.toUpperCase(), reason: `  ${REASON}  ` })
  expect(res.status).toBe(201)
  expect(h.inserted[0]).toMatchObject({ tenant_id: TENANT, platform_admin_user_id: ADMIN, reason: REASON })
  const { requested_at, expires_at } = h.inserted[0] as { requested_at: string; expires_at: string }
  expect(Date.parse(expires_at) - Date.parse(requested_at)).toBe(24 * 3_600_000)
  expect(auditMutation).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'support.consent.request', tenant: { tenantId: TENANT }, target: { table: 'support_consents', id: CONSENT } }),
    { afterResponse: false },
  )
})

it('a request the audit chain cannot record is withdrawn: 503', async () => {
  h.auditOk = false
  expect((await ask()).status).toBe(503)
  expect(h.updates[0].filters).toEqual([['id', CONSENT]])
  expect(h.updates[0].values).toHaveProperty('withdrawn_at')
})

it('the audit log off: 503 before anything is written', async () => {
  h.audit = false
  expect((await ask()).status).toBe(503)
  expect(h.inserted).toEqual([])
})
