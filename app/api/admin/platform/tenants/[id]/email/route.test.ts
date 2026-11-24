// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Email plan D2: a tenant's sender and own domain from the console. Platform host,
// platform admin, strict step-up, never the owner, on the tenant's audit chain or undone.

const ADMIN = 'user_platformAdmin1'
const TENANT = '5e550000-0000-4000-8000-0000000000b2'

const h = vi.hoisted(() => ({
  host: 'stellr' as 'stellr' | 'tenant',
  platformAdmin: true,
  stepUpFresh: true,
  audit: true,
  auditOk: true,
  tenant: null as Record<string, unknown> | null,
  settings: null as Record<string, unknown> | null,
  domainCount: 0,
  taken: null as Record<string, unknown> | null,
  writes: [] as { op: string; values?: unknown }[],
}))
const auditMutation = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => (h.auditOk ? { ok: true, id: 'evt' } : { ok: false, error: 'down' })))
const resend = vi.hoisted(() => ({
  createDomain: vi.fn(async (name: string) => ({ id: 'rd_1', name, status: 'not_started', records: [] })),
  getDomain: vi.fn(async (id: string) => ({ id, name: 'mail.example.org', status: 'verified', records: [] })),
  verifyDomain: vi.fn(async (_id: string) => {}),
  removeDomain: vi.fn(async (_id: string) => {}),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: ADMIN, has: () => h.stepUpFresh }),
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
vi.mock('@/lib/email/resend-domains', async () => {
  const real = await vi.importActual<typeof import('@/lib/email/resend-domains')>('@/lib/email/resend-domains')
  return { ...real, ...resend }
})
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const state = { op: 'select', values: undefined as unknown, head: false, filters: [] as [string, unknown][] }
      const q: Record<string, unknown> = {
        select: (_c: string, opts?: { head?: boolean }) => ((state.head = !!opts?.head), q),
        upsert: (v: unknown) => ((state.op = 'upsert'), (state.values = v), q),
        update: (v: unknown) => ((state.op = 'update'), (state.values = v), q),
        delete: () => ((state.op = 'delete'), q),
        eq: (c: string, v: unknown) => (state.filters.push([c, v]), q),
        not: () => q,
        maybeSingle: async () => {
          if (table === 'tenants') return { data: h.tenant, error: null }
          if (state.filters.some(([c]) => c === 'sending_domain')) return { data: h.taken, error: null }
          return { data: h.settings, error: null }
        },
        then: (ok: (v: unknown) => unknown) => {
          if (state.head) return Promise.resolve({ count: h.domainCount, error: null }).then(ok)
          h.writes.push({ op: state.op, values: state.values })
          return Promise.resolve({ data: null, error: null }).then(ok)
        },
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')

const post = (body: unknown) =>
  POST(new Request(`https://www.example.test/api/admin/platform/tenants/${TENANT}/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: TENANT }),
  })

beforeEach(() => {
  Object.assign(h, { host: 'stellr', platformAdmin: true, stepUpFresh: true, audit: true, auditOk: true, settings: null, domainCount: 0, taken: null, writes: [] })
  h.tenant = { id: TENANT, is_platform_owner: false }
  auditMutation.mockClear()
  Object.values(resend).forEach((f) => f.mockClear())
})

describe('the doors', () => {
  it('a tenant host: 404', async () => {
    h.host = 'tenant'
    expect((await post({ action: 'save', from_name: 'X' })).status).toBe(404)
  })
  it('not a platform admin: 403, nothing written', async () => {
    h.platformAdmin = false
    expect((await post({ action: 'save', from_name: 'X' })).status).toBe(403)
    expect(h.writes).toEqual([])
  })
  it('no recent step-up: 403', async () => {
    h.stepUpFresh = false
    expect((await post({ action: 'save', from_name: 'X' })).status).toBe(403)
  })
  it('the audit log off: 503 before anything changes', async () => {
    h.audit = false
    expect((await post({ action: 'add_domain', domain: 'mail.example.org' })).status).toBe(503)
    expect(resend.createDomain).not.toHaveBeenCalled()
  })
  it('the platform owner: 403', async () => {
    h.tenant = { id: TENANT, is_platform_owner: true }
    expect((await post({ action: 'add_domain', domain: 'mail.example.org' })).status).toBe(403)
  })
  it('an unknown action: 400', async () => {
    expect((await post({ action: 'verify_everything' })).status).toBe(400)
  })
})

describe('save', () => {
  it('writes the checked sender fields and audits them', async () => {
    const res = await post({ action: 'save', from_name: 'Example Events', reply_to: 'office@example.org', sending_domain: 'sneaky.org' })
    expect(res.status).toBe(200)
    expect(h.writes[0]).toMatchObject({ op: 'upsert', values: { tenant_id: TENANT, from_name: 'Example Events', reply_to: 'office@example.org' } })
    expect((h.writes[0].values as Record<string, unknown>).sending_domain).toBeUndefined()
    expect(auditMutation.mock.calls[0][0]).toMatchObject({ action: 'platform.tenant_email.save', tenant: { tenantId: TENANT } })
  })
  it('refuses a bad reply-to', async () => {
    expect((await post({ action: 'save', reply_to: 'nope' })).status).toBe(400)
  })
})

describe('add_domain', () => {
  it('adds it at Resend and stores it as not yet verified', async () => {
    const res = await post({ action: 'add_domain', domain: 'Mail.Example.org' })
    expect(res.status).toBe(200)
    expect(resend.createDomain).toHaveBeenCalledWith('mail.example.org')
    expect(h.writes[0].values).toMatchObject({ sending_domain: 'mail.example.org', resend_domain_id: 'rd_1', domain_status: 'not_started' })
  })
  it("refuses a Stellr domain without calling Resend", async () => {
    expect((await post({ action: 'add_domain', domain: 'x.stellreducation.org' })).status).toBe(400)
    expect(resend.createDomain).not.toHaveBeenCalled()
  })
  it('refuses once the plan’s domains are used up', async () => {
    h.domainCount = 8
    const res = await post({ action: 'add_domain', domain: 'mail.example.org' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'domain_limit' })
  })
  it('refuses a domain another tenant has, or a second domain', async () => {
    h.taken = { tenant_id: 'other' }
    expect((await post({ action: 'add_domain', domain: 'mail.example.org' })).status).toBe(409)
    h.taken = null
    h.settings = { tenant_id: TENANT, sending_domain: 'old.example.org' }
    expect((await post({ action: 'add_domain', domain: 'mail.example.org' })).status).toBe(409)
  })
  it('undoes the row and removes the domain at Resend when the audit fails', async () => {
    h.auditOk = false
    expect((await post({ action: 'add_domain', domain: 'mail.example.org' })).status).toBe(503)
    expect(h.writes.map((w) => w.op)).toEqual(['upsert', 'delete'])
    expect(resend.removeDomain).toHaveBeenCalledWith('rd_1')
  })
})

describe('check and remove', () => {
  it('check asks Resend to verify and stores the new status', async () => {
    h.settings = { tenant_id: TENANT, sending_domain: 'mail.example.org', resend_domain_id: 'rd_1', domain_status: 'pending' }
    expect((await post({ action: 'check' })).status).toBe(200)
    expect(resend.verifyDomain).toHaveBeenCalledWith('rd_1')
    expect(h.writes[0].values).toMatchObject({ domain_status: 'verified' })
  })
  it('remove clears the domain, then removes it at Resend only after the audit', async () => {
    h.settings = { tenant_id: TENANT, sending_domain: 'mail.example.org', resend_domain_id: 'rd_1', domain_status: 'verified' }
    expect((await post({ action: 'remove_domain' })).status).toBe(200)
    expect(h.writes[0].values).toMatchObject({ sending_domain: null, resend_domain_id: null, domain_status: 'none' })
    expect(resend.removeDomain).toHaveBeenCalledWith('rd_1')
  })
  it('remove keeps the domain at Resend and restores the row if the audit fails', async () => {
    h.auditOk = false
    h.settings = { tenant_id: TENANT, sending_domain: 'mail.example.org', resend_domain_id: 'rd_1', domain_status: 'verified' }
    expect((await post({ action: 'remove_domain' })).status).toBe(503)
    expect(h.writes[1]).toMatchObject({ op: 'update', values: { sending_domain: 'mail.example.org', resend_domain_id: 'rd_1', domain_status: 'verified' } })
    expect(resend.removeDomain).not.toHaveBeenCalled()
  })
})

describe('event-blast caps and pause (email plan E)', () => {
  it('saves caps, and clears one with null', async () => {
    expect((await post({ action: 'save', bulk_daily_cap: 500, bulk_monthly_cap: null })).status).toBe(200)
    expect(h.writes[0].values).toMatchObject({ bulk_daily_cap: 500, bulk_monthly_cap: null })
  })
  it('refuses a cap that is not a whole number', async () => {
    expect((await post({ action: 'save', bulk_daily_cap: -1 })).status).toBe(400)
    expect((await post({ action: 'save', bulk_daily_cap: 2.5 })).status).toBe(400)
  })
  it('pauses with a reason, and refuses to pause twice', async () => {
    expect((await post({ action: 'pause_bulk', reason: '  complaints  spiking ' })).status).toBe(200)
    expect(h.writes[0].values).toMatchObject({ paused_reason: 'complaints spiking' })
    expect((h.writes[0].values as Record<string, unknown>).bulk_paused_at).toEqual(expect.any(String))
    expect(auditMutation.mock.calls[0][0]).toMatchObject({ action: 'platform.tenant_email.pause_bulk' })
    h.writes = []
    h.settings = { tenant_id: TENANT, bulk_paused_at: '2026-11-23T00:00:00Z' }
    expect((await post({ action: 'pause_bulk' })).status).toBe(409)
  })
  it('resumes only when paused', async () => {
    expect((await post({ action: 'resume_bulk' })).status).toBe(409)
    h.settings = { tenant_id: TENANT, bulk_paused_at: '2026-11-23T00:00:00Z', paused_reason: 'x' }
    expect((await post({ action: 'resume_bulk' })).status).toBe(200)
    expect(h.writes[0].values).toMatchObject({ bulk_paused_at: null, paused_reason: null })
  })
})
