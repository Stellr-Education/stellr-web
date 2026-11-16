// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The educator PD certificate's artwork and layout (Staff role P3/P4, GATE-AUDIT). A
// theme's default goes on Stellr's chain; an event's own page on its owner's, read from
// the events mirror. The theme, page and change are the metadata, never a storage path.

const OWNER = '11111111-1111-4111-8111-111111111111'
const CALLER = 'user_staffplaceholder'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  mirrored: [] as string[],
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
vi.mock('@/lib/events/mirror', () => ({
  getMirroredEvent: async (slug: string) => {
    h.mirrored.push(slug)
    return { slug, tenant_id: OWNER }
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: CALLER }) }))
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/uploads', () => ({ claimUpload: async () => ({ bytes: new Uint8Array([1]), format: 'png' }), discardUpload: async () => {} }))
vi.mock('@/lib/pd-certificate-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/pd-certificate-store')>()),
  pinDefaultPdPage: async () => 0,
  removePdEventPage: async () => null,
}))

const { PUT, DELETE } = await import('./route')

const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const recorded = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.audits = []
  h.mirrored = []
  h.db = fakeSupabase({})
})

describe('PD certificate artwork', () => {
  it("a theme default's new page goes on Stellr's chain", async () => {
    const res = await PUT(
      new Request('https://app.test/api/admin/pd-certificate', {
        method: 'PUT',
        body: JSON.stringify({ theme: 'space', page: 'front', storagePath: 'pd-certificate/staged-placeholder.png' }),
      }),
    )
    expect(res.status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      { action: 'artwork.pd_certificate.save', tenantId: STELLR_TENANT_ID, actor: CALLER, target: null, metadata: { theme: 'space', change: 'artwork', page: 'front', status: 200 } },
    ])
    expect(h.mirrored).toEqual([])
    expect(JSON.stringify(h.audits)).not.toContain('staged-')
  })

  it("an event's own page, removed, goes on that event's owner's chain", async () => {
    const res = await DELETE(new Request('https://app.test/api/admin/pd-certificate?theme=space&event=tenant-event-2027&page=back', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      {
        action: 'artwork.pd_certificate.delete',
        tenantId: OWNER,
        actor: CALLER,
        target: null,
        metadata: { event_slug: 'tenant-event-2027', theme: 'space', page: 'back', status: 200 },
      },
    ])
    expect(h.mirrored).toEqual(['tenant-event-2027'])
  })

  it('a refused request records nothing', async () => {
    const res = await DELETE(new Request('https://app.test/api/admin/pd-certificate?theme=space&page=back', { method: 'DELETE' }))
    expect(res.status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })
})
