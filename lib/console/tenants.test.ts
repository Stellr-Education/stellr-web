// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { summariseSupport, summariseTenants, usageSeries, windowDays, windowStart, type TenantRow } from './tenants'

// S6-CON: the console's aggregation. Counts only; a person is never part of a summary.

const OWNER: TenantRow = { id: 'o', slug: 'stellr', display_name: 'Stellr', country: 'US', status: 'active', is_platform_owner: true, created_at: '2026-01-01T00:00:00Z' }
const B: TenantRow = { id: 'b', slug: 'bravo', display_name: 'Bravo', country: 'AU', status: 'suspended', is_platform_owner: false, created_at: '2026-11-01T00:00:00Z' }
const A: TenantRow = { id: 'a', slug: 'alpha', display_name: 'Alpha', country: 'AU', status: 'provisioning', is_platform_owner: false, created_at: '2026-11-02T00:00:00Z' }
const NOW = Date.UTC(2026, 10, 23, 15, 0, 0)

describe('windowStart and windowDays', () => {
  it('cover the last 30 UTC days, today included', () => {
    expect(windowStart(NOW)).toBe('2026-10-25')
    const days = windowDays(NOW)
    expect(days).toHaveLength(30)
    expect(days[0]).toBe('2026-10-25')
    expect(days.at(-1)).toBe('2026-11-23')
  })
})

describe('summariseTenants', () => {
  const out = summariseTenants(
    [B, A, OWNER],
    [{ tenant_id: 'b' }, { tenant_id: 'b' }, { tenant_id: 'o' }],
    [
      { tenant_id: 'b', role: 'tenant_admin' },
      { tenant_id: 'b', role: 'event_manager' },
      { tenant_id: 'b', role: 'tenant_admin' },
      { tenant_id: 'b', role: 'owner' },
    ],
    [
      { tenant_id: 'b', kind: 'registration', total: 3 },
      { tenant_id: 'b', kind: 'registration', total: '4' },
      { tenant_id: 'b', kind: 'email', total: 10 },
      { tenant_id: 'o', kind: 'identity', total: 2 },
      { tenant_id: 'o', kind: 'pageview', total: 99 },
    ],
  )

  it('puts the platform owner first, then by name', () => {
    expect(out.map((t) => t.slug)).toEqual(['stellr', 'alpha', 'bravo'])
  })

  it('counts hosts, known roles and known usage kinds, summing bigint strings', () => {
    const b = out.find((t) => t.id === 'b')!
    expect(b.hosts).toBe(2)
    expect(b.roles).toEqual({ tenant_admin: 2, event_manager: 1, staff: 0 })
    expect(b.usage).toEqual({ registration: 7, event: 0, email: 10, identity: 0 })
    expect(out.find((t) => t.id === 'o')!.usage).toEqual({ registration: 0, event: 0, email: 0, identity: 2 })
  })

  it('gives a tenant with nothing zeroes, not gaps', () => {
    const a = out.find((t) => t.id === 'a')!
    expect(a).toMatchObject({ hosts: 0, roles: { tenant_admin: 0, event_manager: 0, staff: 0 }, usage: { registration: 0, event: 0, email: 0, identity: 0 } })
  })

  it('carries no person: only the tenant fields and counts', () => {
    expect(Object.keys(out[0]).sort()).toEqual(['country', 'createdAt', 'hosts', 'id', 'isPlatformOwner', 'name', 'roles', 'slug', 'status', 'usage'])
  })
})

describe('usageSeries', () => {
  it('fills every day of the window with every kind, and drops days outside it', () => {
    const days = ['2026-11-21', '2026-11-22', '2026-11-23']
    const s = usageSeries(
      [
        { day: '2026-11-22', kind: 'identity', total: 4 },
        { day: '2026-11-22', kind: 'email', total: '2' },
        { day: '2026-10-01', kind: 'email', total: 50 },
      ],
      days,
    )
    expect(s.map((d) => d.day)).toEqual(days)
    expect(s[0].totals).toEqual({ registration: 0, event: 0, email: 0, identity: 0 })
    expect(s[1].totals).toEqual({ registration: 0, event: 0, email: 2, identity: 4 })
  })
})

describe('summariseSupport', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  it('counts open sessions, sessions in the window by mode, and requests still waiting', () => {
    const s = summariseSupport(
      [
        { mode: 'read', opened_at: iso(NOW - 10 * 60_000), ends_at: iso(NOW + 20 * 60_000), closed_at: null },
        { mode: 'break_glass', opened_at: iso(NOW - 2 * 86_400_000), ends_at: iso(NOW - 86_400_000), closed_at: null },
        { mode: 'read', opened_at: '2026-09-01T00:00:00Z', ends_at: '2026-09-01T00:30:00Z', closed_at: '2026-09-01T00:10:00Z' },
      ],
      [
        { approved_at: null, declined_at: null, withdrawn_at: null, expires_at: iso(NOW + 3_600_000) },
        { approved_at: iso(NOW), declined_at: null, withdrawn_at: null, expires_at: iso(NOW + 3_600_000) },
        { approved_at: null, declined_at: null, withdrawn_at: iso(NOW), expires_at: iso(NOW + 3_600_000) },
        { approved_at: null, declined_at: null, withdrawn_at: null, expires_at: iso(NOW - 1) },
      ],
      NOW,
      windowStart(NOW),
    )
    expect(s).toEqual({ open: 1, read: 1, breakGlass: 1, pendingConsents: 1 })
  })
})
