// @vitest-environment node
//
// backlog-batch2.10 follow-up: the alumni cron upgrades a cohort from the
// August school-year rollover, not 1 July, so a rising senior whose year is
// this school year is never upgraded in July. A stand-in client; no database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Member = { id: string; graduation_year: number }

const h = vi.hoisted(() => ({
  members: [] as Array<{ id: string; graduation_year: number }>,
  lteBound: [] as number[],
  granted: [] as string[],
  notified: [] as string[],
}))

/** A chainable stand-in for the tables the cron touches. */
function fakeDb() {
  return {
    from(table: string) {
      if (table === 'membership_tiers') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'tier-alumni' }, error: null }) }) }) }
      }
      if (table === 'members') {
        return {
          select: () => ({
            not: () => ({
              lte: async (_c: string, bound: number) => {
                h.lteBound.push(bound)
                return { data: h.members.filter((m) => m.graduation_year <= bound), error: null }
              },
            }),
          }),
        }
      }
      if (table === 'sent_reminders') {
        return { insert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) }
      }
      if (table === 'member_memberships') {
        const eqChain = { eq: () => eqChain, neq: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) }
        return {
          select: () => eqChain,
          insert: (row: { member_id: string }) => ({
            select: () => ({
              maybeSingle: async () => {
                h.granted.push(row.member_id)
                return { data: { id: `mm-${row.member_id}` }, error: null }
              },
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-audit', () => ({ withCronAudit: (_job: string, fn: unknown) => fn }))
vi.mock('@/lib/cron-runs', () => ({ startCronRun: async () => ({ fail: vi.fn(), finish: vi.fn() }) }))
vi.mock('@/lib/entitlements', () => ({ grantTierAllocations: async () => undefined }))
vi.mock('@/lib/notify', () => ({
  notifyMember: async (id: string) => {
    h.notified.push(id)
  },
}))

import { GET } from './route'

const run = async (at: Date) => {
  vi.setSystemTime(at)
  const res = await GET(new NextRequest('https://example.test/api/cron/alumni-upgrades'))
  return (await res.json()) as { upgraded: number }
}

const cohorts = (): Member[] => [
  { id: 'class-2026', graduation_year: 2026 },
  { id: 'class-2027', graduation_year: 2027 },
  { id: 'class-2028', graduation_year: 2028 },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  h.members = cohorts()
  h.lteBound.length = 0
  h.granted.length = 0
  h.notified.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/cron/alumni-upgrades: the August rollover', () => {
  it('on 30 June upgrades only cohorts whose school year has ended', async () => {
    expect(await run(new Date(Date.UTC(2027, 5, 30, 12)))).toEqual({ upgraded: 1 })
    expect(h.lteBound).toEqual([2026])
    expect(h.granted).toEqual(['class-2026'])
  })

  it('on 15 July does not upgrade the class of 2027 (a rising senior may hold that year)', async () => {
    expect(await run(new Date(Date.UTC(2027, 6, 15, 8)))).toEqual({ upgraded: 1 })
    expect(h.lteBound).toEqual([2026])
    expect(h.granted).toEqual(['class-2026'])
    expect(h.granted).not.toContain('class-2027')
  })

  it('on 1 August upgrades the class of 2027, and never 2028', async () => {
    expect(await run(new Date(Date.UTC(2027, 7, 1, 8)))).toEqual({ upgraded: 2 })
    expect(h.lteBound).toEqual([2027])
    expect(h.granted).toEqual(['class-2026', 'class-2027'])
    expect(h.notified).toEqual(['class-2026', 'class-2027'])
  })
})
