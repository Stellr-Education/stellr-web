// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 C20a: the New Object wizard's Space and cohort rows name no event, so the S3
// trigger would log `no_key` for them, and derivation enforce would refuse them. Each
// carries Stellr's tenant_id itself (community and mentoring are Stellr-only in release
// 1). In log mode the trigger keeps a supplied tenant_id that agrees with the derived
// one, so Stellr's rows get the value they get today, and the response is unchanged.

const h = vi.hoisted(() => ({
  claims: { metadata: { role: 'admin' } } as unknown,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  fireObjectCreatedRules: vi.fn(async () => ({ attached: 0 })),
}))

function from(table: string) {
  const q: Record<string, unknown> = {}
  q.insert = (row: Record<string, unknown>) => {
    h.inserts.push({ table, row })
    return q
  }
  q.select = () => q
  q.single = async () => ({ data: { id: `${table}-1` }, error: null })
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
  return q
}

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: h.claims }) }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: (c: { metadata?: { role?: string } } | null) => c?.metadata?.role === 'admin' }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/object-created-rules', () => ({ fireObjectCreatedRules: h.fireObjectCreatedRules }))
vi.mock('@/lib/events/repo', () => ({ getAllEvents: async () => [], getAllCampaigns: async () => [] }))

import { POST } from './route'

const post = (body: unknown) => POST(new Request('http://localhost/api/admin/access/objects', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.claims = { metadata: { role: 'admin' } }
  h.inserts = []
  h.fireObjectCreatedRules.mockClear()
})

describe('POST /api/admin/access/objects: explicit tenant_id (S5 C20a)', () => {
  it("writes a Space with Stellr's tenant_id, and answers as before", async () => {
    const res = await post({ objectType: 'space', name: 'Study Hall' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, ref: 'community_spaces-1', objectType: 'space', rules: { attached: 0 } })
    const space = h.inserts.find((i) => i.table === 'community_spaces')
    expect(space?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, slug: 'study-hall', name: 'Study Hall' })
  })

  it("writes a mentoring cohort with Stellr's tenant_id", async () => {
    const res = await post({ objectType: 'cohort', name: 'Spring cohort' })
    expect(res.status).toBe(200)
    const cohort = h.inserts.find((i) => i.table === 'mentoring_cohorts')
    expect(cohort?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, name: 'Spring cohort', container_type: 'mentoring' })
  })

  it("writes a coaching workshop with Stellr's tenant_id", async () => {
    await post({ objectType: 'workshop', name: 'Pitch clinic' })
    const workshop = h.inserts.find((i) => i.table === 'mentoring_cohorts')
    expect(workshop?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, container_type: 'coaching' })
  })

  it('takes no tenant_id from the request body', async () => {
    await post({ objectType: 'space', name: 'Other', tenant_id: '00000000-0000-4000-8000-0000000000aa', tenantId: 'x' })
    expect(h.inserts.find((i) => i.table === 'community_spaces')?.row.tenant_id).toBe(STELLR_TENANT_ID)
  })

  it('still refuses a non-admin before any write', async () => {
    h.claims = { metadata: { role: 'member' } }
    expect((await post({ objectType: 'space', name: 'x' })).status).toBe(403)
    expect(h.inserts).toEqual([])
  })
})
