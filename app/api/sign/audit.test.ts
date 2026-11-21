// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The signer's side of Stellr signing (S5 wave 9, C7's gate). The signer has no account,
// so the actor is anonymous; the recipient is the target and the envelope's own tenant
// picks the chain, NULL being Stellr's. A refused link is a 404 and records nothing. An
// answer with no session goes on the platform chain, marked unresolved.

const TENANT = '11111111-1111-4111-8111-111111111111'
const RECIPIENT = '22222222-2222-4222-8222-222222222222'
const AGREEMENT = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  ctx: null as null | { recipient: { id: string }; envelope: { id: string; tenant_id: string | null } },
  link: { kind: 'not_yet' } as Record<string, unknown>,
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    h.afters.push(task)
  },
}))
vi.mock('@/lib/audit/platform', async (orig) => ({
  ...(await orig<typeof import('@/lib/audit/platform')>()),
  audit: async (input: Record<string, unknown>) => {
    h.audits.push(input)
    return { ok: true, id: h.audits.length, chainSeq: h.audits.length }
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: async () => ({ tenantId: STELLR_TENANT_ID }) }))
vi.mock('@/lib/esign/native/flow', () => ({
  recordViewed: async () => {},
  openLink: async () => h.link,
}))
vi.mock('@/lib/esign/native/http', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/native/http')>()),
  throttle: async () => null,
  sameOrigin: () => true,
  actingSession: async () => h.ctx,
  requestMeta: () => ({}),
}))

const { POST: viewed } = await import('./viewed/route')
const { POST: session } = await import('./session/route')

const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const req = (path: string, body: unknown = {}) => new Request(`https://app.test/api/sign/${path}`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters.length = 0
  h.audits.length = 0
  h.ctx = null
  h.link = { kind: 'not_yet' }
})

describe('sign routes: platform audit', () => {
  it('records a view on the envelope tenant’s chain, anonymous, with the recipient as the target', async () => {
    h.ctx = { recipient: { id: RECIPIENT }, envelope: { id: AGREEMENT, tenant_id: TENANT } }
    const res = await viewed(req('viewed'))
    expect(res.status).toBe(200)
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({
      tenantId: TENANT,
      actor: 'system',
      action: 'esign.signer.viewed',
      target: { table: 'agreement_recipients', id: RECIPIENT },
      metadata: { agreement_id: AGREEMENT, actor_anonymous: true, status: 200 },
    })
  })

  it('puts an envelope with no tenant yet on Stellr’s chain', async () => {
    h.ctx = { recipient: { id: RECIPIENT }, envelope: { id: AGREEMENT, tenant_id: null } }
    await viewed(req('viewed'))
    await flush()
    expect(h.audits[0]).toMatchObject({ tenantId: STELLR_TENANT_ID })
  })

  it('records nothing for a refused session', async () => {
    const res = await viewed(req('viewed'))
    expect(res.status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
  })

  it('records a link that is not ready yet on the platform chain, marked, with its state and no token', async () => {
    const res = await session(req('session', { token: 'placeholder-token' }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({
      tenantId: null,
      action: 'esign.signer.session_open',
      target: { table: 'agreement_recipients', id: null },
      metadata: { link_state: 'not_yet', tenant_unresolved: true },
    })
    expect(JSON.stringify(h.audits[0])).not.toContain('placeholder-token')
  })

  it('a refused link records nothing', async () => {
    h.link = { kind: 'invalid' }
    const res = await session(req('session', { token: 'placeholder-token' }))
    expect(res.status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
  })
})
