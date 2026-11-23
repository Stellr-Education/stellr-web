import { beforeEach, describe, expect, it, vi } from 'vitest'

// S6-SUP-UI: the console's support panel. Nothing with support mode off or for the
// platform owner; otherwise it reads only the viewer's own requests for this tenant,
// times only, never a reason.

const h = vi.hoisted(() => ({
  enabled: true,
  session: null as null | { mode: 'read'; tenantId: string; tenantName: string; endsAt: number },
  queries: [] as { table: string; select: string; filters: [string, unknown][] }[],
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_platformAdmin1' }) }))
vi.mock('@/lib/authz/support-session', () => ({ supportModeEnabled: () => h.enabled }))
vi.mock('@/lib/authz/support-session-server', () => ({ loadSupportSession: async () => h.session }))
vi.mock('@/components/admin/TenantSupportActions', () => ({ TenantSupportActions: (p: unknown) => ({ type: 'actions', props: p }) }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const q = { table, select: '', filters: [] as [string, unknown][] }
      h.queries.push(q)
      const chain = {
        select: (cols: string) => ((q.select = cols), chain),
        eq: (c: string, v: unknown) => (q.filters.push([c, v]), chain),
        order: () => chain,
        limit: async () => ({
          data: [{ id: 'c1', requested_at: '2026-11-23T10:00:00Z', expires_at: '2999-01-01T00:00:00Z', approved_at: '2026-11-23T11:00:00Z', declined_at: null, withdrawn_at: null, used_at: null }],
          error: null,
        }),
      }
      return chain
    },
  }),
}))

const { TenantSupportPanel } = await import('./TenantSupportPanel')
const TENANT = '5e550000-0000-4000-8000-0000000000b2'

beforeEach(() => {
  h.enabled = true
  h.session = null
  h.queries = []
})

describe('TenantSupportPanel', () => {
  it('support mode off, or the platform owner: nothing, and nothing read', async () => {
    h.enabled = false
    expect(await TenantSupportPanel({ tenantId: TENANT, tenantName: 'B', isPlatformOwner: false })).toBeNull()
    h.enabled = true
    expect(await TenantSupportPanel({ tenantId: TENANT, tenantName: 'B', isPlatformOwner: true })).toBeNull()
    expect(h.queries).toEqual([])
  })

  it("reads only the viewer's own requests for this tenant, without the reason", async () => {
    const el = JSON.stringify(await TenantSupportPanel({ tenantId: TENANT, tenantName: 'B', isPlatformOwner: false }))
    expect(h.queries).toEqual([
      {
        table: 'support_consents',
        select: 'id, requested_at, expires_at, approved_at, declined_at, withdrawn_at, used_at',
        filters: [
          ['tenant_id', TENANT],
          ['platform_admin_user_id', 'user_platformAdmin1'],
        ],
      },
    ])
    expect(h.queries[0].select).not.toContain('reason')
    expect(el).toContain('"status":"approved"')
  })

  it('a session on another tenant is passed on as not here', async () => {
    h.session = { mode: 'read', tenantId: 'other', tenantName: 'Other', endsAt: 1 }
    const el = JSON.stringify(await TenantSupportPanel({ tenantId: TENANT, tenantName: 'B', isPlatformOwner: false }))
    expect(el).toContain('"here":false')
  })
})
