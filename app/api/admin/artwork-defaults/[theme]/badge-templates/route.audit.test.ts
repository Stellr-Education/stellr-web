// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// A theme's default badge and certificate artwork (Staff role P3/P4, GATE-AUDIT): Staff
// write these through competitions:write. Each save or delete records one platform audit
// event on Stellr's chain, with the theme, format, audience or award (enums) as metadata
// and never an artwork path.

const TEMPLATE = '66666666-6666-4666-8666-666666666666'
const CALLER = 'user_staffplaceholder'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
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
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: CALLER }) }))
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/artwork-template-input', async (orig) => ({
  ...(await orig<typeof import('@/lib/artwork-template-input')>()),
  claimArtwork: async () => null,
}))
vi.mock('@/lib/event-badges', () => ({
  fillPlacements: async (_db: unknown, t: unknown) => t,
  loadDefaultBadgeTemplate: async () => ({ id: TEMPLATE }),
  loadDefaultBadgeTemplates: async () => [],
  prepareTemplate: async () => null,
}))
vi.mock('@/lib/event-certificates', () => ({
  loadDefaultTemplate: async () => ({ theme: 'space', award_type: 'participation', artwork_path: 'artwork-defaults/space/certificate-participation-1.png' }),
  loadDefaultTemplates: async () => [],
  pinDefaultCertificate: async () => {},
}))

const badges = await import('./route')
const certificates = await import('../certificate-templates/route')

const send = (method: string, path: string, body?: unknown) =>
  new Request(`https://app.test/api/admin/artwork-defaults/space/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const ctx = { params: Promise.resolve({ theme: 'space' }) }
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const recorded = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))
const common = { tenantId: STELLR_TENANT_ID, actor: CALLER }

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.audits = []
  h.db = fakeSupabase({
    default_badge_templates: [{ id: TEMPLATE, theme: 'space', format: 'avery_5392', audience: 'everyone', artwork_path: 'artwork-defaults/space/badge-1.png' }],
    default_certificate_templates: [{ theme: 'space', award_type: 'participation', artwork_path: 'artwork-defaults/space/certificate-participation-1.png' }],
  })
})

describe('a theme default badge', () => {
  it('a save names the template; a delete names the id it was given', async () => {
    expect((await badges.PUT(send('PUT', 'badge-templates', { format: 'avery_5392', audience: 'everyone' }), ctx)).status).toBe(200)
    expect((await badges.DELETE(send('DELETE', `badge-templates?id=${TEMPLATE}`), ctx)).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      {
        ...common,
        action: 'artwork.default_badge.save',
        target: { table: 'default_badge_templates', id: TEMPLATE },
        metadata: { theme: 'space', format: 'avery_5392', audience: 'everyone', status: 200 },
      },
      { ...common, action: 'artwork.default_badge.delete', target: { table: 'default_badge_templates', id: TEMPLATE }, metadata: { theme: 'space', status: 200 } },
    ])
  })

  it('an unknown theme is refused and records nothing', async () => {
    const res = await badges.PUT(send('PUT', 'badge-templates', { format: 'avery_5392', audience: 'everyone' }), { params: Promise.resolve({ theme: 'nope' }) })
    expect(res.status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
  })
})

describe('a theme default certificate', () => {
  it('a save and a delete each record the theme and award, with no row id', async () => {
    expect((await certificates.PUT(send('PUT', 'certificate-templates', { awardType: 'participation' }), ctx)).status).toBe(200)
    expect((await certificates.DELETE(send('DELETE', 'certificate-templates?awardType=participation'), ctx)).status).toBe(200)
    await flush()
    const metadata = { theme: 'space', award_type: 'participation', status: 200 }
    expect(recorded()).toEqual([
      { ...common, action: 'artwork.default_certificate.save', target: { table: 'default_certificate_templates', id: null }, metadata },
      { ...common, action: 'artwork.default_certificate.delete', target: { table: 'default_certificate_templates', id: null }, metadata },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('artwork-defaults/')
  })
})
