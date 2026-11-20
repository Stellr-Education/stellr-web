// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 A8b. A member's own past-event record names no event, so the S3 trigger has no
// key to derive a tenant from: it logs `no_key`, and derivation enforce would refuse
// the write. Event history is Stellr's (decision B8), so the route writes Stellr's id
// itself: the value the trigger stamps on such a row today.

const h = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  userId: 'user_placeholder' as string | null,
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: vi.fn(async () => {}) }))
vi.mock('@/lib/community/self-service-audit', () => ({ noteAudit: vi.fn(), selfServiceEvent: vi.fn(async () => null) }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      let inserted: Record<string, unknown> | null = null
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.insert = (row: Record<string, unknown>) => { inserted = row; h.inserts.push({ table, row }); return chain }
      chain.single = async () => ({ data: table === 'members' ? { id: 'mem-1' } : { id: 'ep-1', ...inserted }, error: null })
      return chain
    },
  }),
}))

const { POST } = await import('./route')

const post = (body: Record<string, unknown>) =>
  POST(new Request('https://www.stellreducation.org/api/members/event-participations', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.inserts.length = 0
  h.userId = 'user_placeholder'
})

describe('POST /api/members/event-participations (S5 A8b)', () => {
  it('writes Stellr’s id on the event-less row, and answers as before', async () => {
    const res = await post({ event_year: 2025, event_location: 'Denver', team_name: 'Orbit', award: null })
    expect(res.status).toBe(200)
    expect(h.inserts).toEqual([{
      table: 'event_participations',
      row: { member_id: 'mem-1', tenant_id: STELLR_TENANT_ID, event_year: 2025, event_location: 'Denver', team_name: 'Orbit', award: null, status: 'pending' },
    }])
    expect((await res.json()).participation).toMatchObject({ id: 'ep-1', member_id: 'mem-1' })
  })

  it('a tenant_id in the body is ignored', async () => {
    await post({ event_year: 2025, tenant_id: '00000000-0000-4000-8000-0000000000aa' })
    expect(h.inserts[0].row.tenant_id).toBe(STELLR_TENANT_ID)
  })

  it('signed out: 401 before any write', async () => {
    h.userId = null
    expect((await post({ event_year: 2025 })).status).toBe(401)
    expect(h.inserts).toEqual([])
  })
})
