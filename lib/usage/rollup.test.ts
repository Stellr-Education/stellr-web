// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { purgeCutoff, rollupDays, runUsageRollup, USAGE_RAW_RETENTION_DAYS, utcDay } from './rollup'

// S6-USE, the gate on a fake database: after a run, usage_daily per tenant, day
// and kind equals the count taken straight from the raw rows. The fake's
// usage_rollup follows the SQL in migration 20261123023107_usage_events (sum the
// day's usage_events per tenant and kind, add the day's new members as the
// owner's identities, upsert, refuse a day outside the raw window). The same
// equality on real Postgres is proven by supabase/tests/database/
// usage_events.test.sql and test/integration/two-tenant/usage.int.test.ts.

const OWNER = '00000000-0000-4000-8000-000000000001'
const OTHER = 'a6000000-0000-4000-8000-000000000001'
const DAY_MS = 86_400_000

interface Ev { id: number; tenant_id: string; kind: string; occurred_at: string; count: number }

function fakeDb(now: Date, events: Ev[], memberCreatedAt: string[], opts: { failRpc?: string; failPurge?: boolean } = {}) {
  const daily = new Map<string, number>()
  const calls: string[] = []
  const inDay = (iso: string, day: string) => iso.slice(0, 10) === day
  const db = {
    async rpc(fn: string, args: { p_day: string }) {
      calls.push(`${fn}:${args.p_day}`)
      if (fn !== 'usage_rollup') throw new Error(`unexpected rpc ${fn}`)
      if (opts.failRpc === args.p_day) return { data: null, error: { message: 'rollup failed' } }
      const oldest = utcDay(new Date(now.getTime() - 89 * DAY_MS))
      if (args.p_day < oldest) return { data: null, error: { message: 'outside the 90-day raw window' } }
      const totals = new Map<string, number>()
      for (const e of events) if (inDay(e.occurred_at, args.p_day)) totals.set(`${e.tenant_id}|${e.kind}`, (totals.get(`${e.tenant_id}|${e.kind}`) ?? 0) + e.count)
      for (const at of memberCreatedAt) if (inDay(at, args.p_day)) totals.set(`${OWNER}|identity`, (totals.get(`${OWNER}|identity`) ?? 0) + 1)
      for (const [k, v] of totals) daily.set(`${k.split('|')[0]}|${args.p_day}|${k.split('|')[1]}`, v)
      return { data: totals.size, error: null }
    },
    from(table: string) {
      if (table !== 'usage_events') throw new Error(`unexpected table ${table}`)
      let cutoff = ''
      const q = {
        delete: () => q,
        lt: (col: string, v: string) => {
          if (col !== 'occurred_at') throw new Error(`unexpected filter ${col}`)
          cutoff = v
          return q
        },
        select: async () => {
          calls.push(`purge:${cutoff}`)
          if (opts.failPurge) return { data: null, error: { message: 'purge failed' } }
          const gone = events.filter((e) => e.occurred_at < cutoff)
          for (const g of gone) events.splice(events.indexOf(g), 1)
          return { data: gone.map((g) => ({ id: g.id })), error: null }
        },
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient, daily, calls, events }
}

/** The "SQL count": straight off the raw rows, independent of the roll-up. */
function countsFor(day: string, events: Ev[], memberCreatedAt: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of events.filter((x) => x.occurred_at.startsWith(day))) {
    const k = `${e.tenant_id}|${day}|${e.kind}`
    out.set(k, (out.get(k) ?? 0) + e.count)
  }
  const ids = memberCreatedAt.filter((at) => at.startsWith(day)).length
  if (ids) out.set(`${OWNER}|${day}|identity`, ids)
  return out
}

const NOW = new Date('2026-11-23T00:30:00.000Z')
const fail = () => {}

function fixture(): { events: Ev[]; members: string[] } {
  let id = 0
  const ev = (tenant_id: string, kind: string, occurred_at: string, count = 1): Ev => ({ id: ++id, tenant_id, kind, occurred_at, count })
  return {
    events: [
      ev(OWNER, 'registration', '2026-11-22T01:00:00.000Z'),
      ev(OWNER, 'registration', '2026-11-22T23:59:59.999Z'),
      ev(OWNER, 'email', '2026-11-22T10:00:00.000Z', 4),
      ev(OWNER, 'event', '2026-11-22T12:00:00.000Z', 2),
      ev(OTHER, 'registration', '2026-11-22T05:00:00.000Z'),
      ev(OTHER, 'email', '2026-11-22T06:00:00.000Z', 2),
      ev(OTHER, 'email', '2026-11-23T00:10:00.000Z'),
      // The day before yesterday: not rolled up by this run.
      ev(OTHER, 'email', '2026-11-21T23:59:59.999Z'),
      // Outside the raw window: purged.
      ev(OTHER, 'email', '2026-08-20T00:00:00.000Z'),
      ev(OWNER, 'event', '2026-08-24T00:29:59.000Z'),
    ],
    members: ['2026-11-22T08:00:00.000Z', '2026-11-22T09:00:00.000Z', '2026-11-23T00:05:00.000Z'],
  }
}

describe('the days and the window', () => {
  it('rolls up yesterday and today, UTC', () => {
    expect(rollupDays(NOW)).toEqual(['2026-11-22', '2026-11-23'])
    expect(rollupDays(new Date('2026-03-01T23:59:59Z'))).toEqual(['2026-02-28', '2026-03-01'])
  })

  it('purges rows older than 90 days', () => {
    expect(USAGE_RAW_RETENTION_DAYS).toBe(90)
    expect(purgeCutoff(NOW)).toBe('2026-08-25T00:30:00.000Z')
  })
})

describe('runUsageRollup', () => {
  it('leaves usage_daily equal to the raw counts per tenant, day and kind', async () => {
    const { events, members } = fixture()
    const expected = new Map([...countsFor('2026-11-22', events, members), ...countsFor('2026-11-23', events, members)])
    const f = fakeDb(NOW, events, members)

    const result = await runUsageRollup(f.db, { now: NOW, fail })

    expect(new Map([...f.daily].sort())).toEqual(new Map([...expected].sort()))
    expect(f.daily.get(`${OTHER}|2026-11-22|email`)).toBe(2)
    expect(f.daily.get(`${OWNER}|2026-11-22|identity`)).toBe(2)
    expect(result).toEqual({ days: [{ day: '2026-11-22', rows: 6 }, { day: '2026-11-23', rows: 2 }], purged: 2, failures: 0 })
  })

  it('is idempotent: a second run writes the same totals', async () => {
    const { events, members } = fixture()
    const f = fakeDb(NOW, events, members)
    await runUsageRollup(f.db, { now: NOW, fail })
    const first = new Map(f.daily)
    const again = await runUsageRollup(f.db, { now: NOW, fail })
    expect(f.daily).toEqual(first)
    expect(again.purged).toBe(0)
  })

  it('rolls up before it purges, and purges only past the window', async () => {
    const { events, members } = fixture()
    const f = fakeDb(NOW, events, members)
    await runUsageRollup(f.db, { now: NOW, fail })
    expect(f.calls).toEqual(['usage_rollup:2026-11-22', 'usage_rollup:2026-11-23', 'purge:2026-08-25T00:30:00.000Z'])
    expect(f.events.some((e) => e.occurred_at.startsWith('2026-08'))).toBe(false)
    expect(f.events).toHaveLength(8)
  })

  it('records a failed day and a failed purge, and still runs the rest', async () => {
    const { events, members } = fixture()
    const f = fakeDb(NOW, events, members, { failRpc: '2026-11-22', failPurge: true })
    const failed: string[] = []
    const result = await runUsageRollup(f.db, { now: NOW, fail: (where) => failed.push(where) })
    expect(failed).toEqual(['rollup:2026-11-22', 'purge'])
    expect(result).toEqual({ days: [{ day: '2026-11-22', rows: null }, { day: '2026-11-23', rows: 2 }], purged: null, failures: 2 })
  })
})
