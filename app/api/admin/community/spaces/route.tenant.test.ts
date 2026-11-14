// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 C20a: an admin-created Space names no event, so the S3 trigger would log `no_key`
// for it, and derivation enforce would refuse it. The row carries Stellr's tenant_id
// itself (community is Stellr-only in release 1). In log mode the trigger keeps a
// supplied tenant_id that agrees with the derived one, so the value is today's.

const h = vi.hoisted(() => ({
  stellrAdmin: true,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  insertError: null as { code: string; message: string } | null,
}))

function from(table: string) {
  const q: Record<string, unknown> = {}
  q.insert = (row: Record<string, unknown>) => {
    h.inserts.push({ table, row })
    return q
  }
  q.select = () => q
  q.eq = () => q
  q.single = async () => (h.insertError ? { data: null, error: h.insertError } : { data: { id: 'space-1' }, error: null })
  q.maybeSingle = async () => ({ data: { id: 'member-1' }, error: null })
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
  return q
}

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_admin_placeholder' }) }))
vi.mock('@/lib/authz', () => ({ isStellrAdmin: async () => h.stellrAdmin, hasCapability: async () => h.stellrAdmin }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/container-sync', () => ({ ensureSpaceContainer: async () => {} }))

import { POST } from './route'

const post = (body: unknown) => POST(new Request('http://localhost/api/admin/community/spaces', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.stellrAdmin = true
  h.inserts = []
  h.insertError = null
})

describe('POST /api/admin/community/spaces: explicit tenant_id (S5 C20a)', () => {
  it("writes the Space with Stellr's tenant_id, and answers as before", async () => {
    const res = await post({ name: 'Launch Pad', access_type: 'private' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'space-1' })
    const space = h.inserts.find((i) => i.table === 'community_spaces')
    expect(space?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, slug: 'launch-pad', name: 'Launch Pad', access_type: 'private' })
  })

  it('takes no tenant_id from the request body', async () => {
    await post({ name: 'Launch Pad', tenant_id: '00000000-0000-4000-8000-0000000000aa' })
    expect(h.inserts.find((i) => i.table === 'community_spaces')?.row.tenant_id).toBe(STELLR_TENANT_ID)
  })

  it('keeps the duplicate-slug answer', async () => {
    h.insertError = { code: '23505', message: 'duplicate' }
    const res = await post({ name: 'Launch Pad' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'A space with that slug already exists' })
  })

  it('still refuses a caller who is not a Stellr admin before any write', async () => {
    h.stellrAdmin = false
    expect((await post({ name: 'x' })).status).toBe(403)
    expect(h.inserts).toEqual([])
  })
})
