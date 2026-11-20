// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 A8b. Staff adding a past-event record for a member: the row names no event, so
// the S3 trigger can't derive a tenant (it logs `no_key`; enforce would refuse it).
// Event history is Stellr's (decision B8), and this route audits on Stellr's chain, so
// it writes Stellr's id itself: the value the trigger stamps on such a row today.

const h = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  allowed: true,
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_placeholder', sessionClaims: {} }) }))
vi.mock('@/lib/authz', () => ({ hasCapability: async () => h.allowed }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: vi.fn(async () => ({ rule: null, granted: false })) }))
// The audit wrapper is exercised elsewhere (test/audit-coverage.test.ts); here it just runs the handler.
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))
vi.mock('@/lib/audit/route-subject', () => ({ auditSubject: () => ({ target: null, metadata: {} }), noteAuditSubject: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      let inserted: Record<string, unknown> | null = null
      chain.select = () => chain
      chain.insert = (row: Record<string, unknown>) => { inserted = row; h.inserts.push({ table, row }); return chain }
      chain.single = async () => ({ data: { id: 'ep-1', ...inserted }, error: null })
      return chain
    },
  }),
}))

const { POST } = await import('./route')

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://www.stellreducation.org/api/admin/members/mem-1/event-participations', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'mem-1' }) },
  )

beforeEach(() => {
  h.inserts.length = 0
  h.allowed = true
})

describe('POST /api/admin/members/[id]/event-participations (S5 A8b)', () => {
  it('writes Stellr’s id on the event-less row, and answers as before', async () => {
    const res = await post({ event_year: 2024, event_location: 'Boulder', team_name: null, award: null })
    expect(res.status).toBe(200)
    expect(h.inserts).toEqual([{
      table: 'event_participations',
      row: { member_id: 'mem-1', tenant_id: STELLR_TENANT_ID, event_year: 2024, event_location: 'Boulder', team_name: null, award: null },
    }])
    expect(await res.json()).toMatchObject({ participation: { id: 'ep-1', member_id: 'mem-1' }, grants: [{ trigger: 'event_attendance', rule: null, granted: false }] })
  })

  it('a tenant_id in the body is ignored', async () => {
    await post({ event_year: 2024, tenant_id: '00000000-0000-4000-8000-0000000000aa' })
    expect(h.inserts[0].row.tenant_id).toBe(STELLR_TENANT_ID)
  })

  it('without members:write: 403 before any write', async () => {
    h.allowed = false
    expect((await post({ event_year: 2024 })).status).toBe(403)
    expect(h.inserts).toEqual([])
  })
})
