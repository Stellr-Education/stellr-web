import { describe, expect, it, vi } from 'vitest'
import { recordTenantBulk, tenantBulkAllowance } from './tenant-bulk'

const T = '5e550000-0000-4000-8000-0000000000b2'
const NOW = new Date('2026-11-23T12:00:00Z')

function db(settings: Record<string, unknown> | null, rows: { day: string; sent: number }[] = [], fail?: 'settings' | 'count') {
  return {
    rpc: vi.fn(async () => ({ data: 1, error: null })),
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.maybeSingle = async () => (fail === 'settings' ? { data: null, error: { message: 'down' } } : { data: settings, error: null })
      q.gte = async () => (fail === 'count' ? { data: null, error: { message: 'down' } } : { data: rows, error: null })
      void table
      return q
    },
  }
}

describe('tenantBulkAllowance', () => {
  it('is unlimited with no settings row or no caps', async () => {
    expect((await tenantBulkAllowance(db(null) as never, T, NOW)).remaining).toBe(Infinity)
    expect((await tenantBulkAllowance(db({ bulk_daily_cap: null, bulk_monthly_cap: null, bulk_paused_at: null }) as never, T, NOW)).remaining).toBe(Infinity)
  })
  it('is 0 while paused', async () => {
    expect(await tenantBulkAllowance(db({ bulk_paused_at: '2026-11-23T00:00:00Z' }) as never, T, NOW)).toEqual({ remaining: 0, reason: 'paused' })
  })
  it('takes the smaller of what is left today and this billing month', async () => {
    const rows = [{ day: '2026-11-23', sent: 30 }, { day: '2026-11-10', sent: 900 }]
    expect((await tenantBulkAllowance(db({ bulk_daily_cap: 100, bulk_monthly_cap: 1000 }, rows) as never, T, NOW)).remaining).toBe(70)
    expect(await tenantBulkAllowance(db({ bulk_daily_cap: 100, bulk_monthly_cap: 930 }, rows) as never, T, NOW)).toEqual({ remaining: 0, reason: 'monthly_cap' })
    expect(await tenantBulkAllowance(db({ bulk_daily_cap: 30, bulk_monthly_cap: null }, rows) as never, T, NOW)).toEqual({ remaining: 0, reason: 'daily_cap' })
  })
  it('fails closed when it cannot read', async () => {
    expect(await tenantBulkAllowance(db(null, [], 'settings') as never, T, NOW)).toEqual({ remaining: 0, reason: 'unreadable' })
    expect(await tenantBulkAllowance(db({ bulk_daily_cap: 5 }, [], 'count') as never, T, NOW)).toEqual({ remaining: 0, reason: 'unreadable' })
  })
})

describe('recordTenantBulk', () => {
  it('bumps by the number sent, and skips zero', async () => {
    const d = db(null)
    await recordTenantBulk(d as never, T, 0, NOW)
    expect(d.rpc).not.toHaveBeenCalled()
    await recordTenantBulk(d as never, T, 12, NOW)
    expect(d.rpc).toHaveBeenCalledWith('bump_tenant_bulk_sends', { p_tenant_id: T, p_day: '2026-11-23', p_n: 12 })
  })
})
