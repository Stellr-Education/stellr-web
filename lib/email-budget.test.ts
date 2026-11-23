import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingPeriodStart, canSend, dailyCap, marketingCap, monthlyCap, monthlyMarketingCap,
  monthlyTransactionalReserve, recordSend, transactionalReserve, utcDay,
} from '@/lib/email-budget'

// deep review INT-2 / PUB-4: the shared daily Resend budget and its
// transactional reserve. A db stub stands in for the one `email_send_quota`
// row; we drive the stored count and the read outcome per test.

type ReadResult = { data: { sent: number } | null; error: { message: string } | null }

type MonthResult = { data: { sent: number }[] | null; error: { message: string } | null }

function quotaDb(
  read: ReadResult,
  rpc?: (name: string, args: unknown) => Promise<{ error: unknown }>,
  month: MonthResult = { data: [], error: null },
  onGte?: (day: string) => void,
) {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => read }),
          gte: async (_col: string, day: string) => { onGte?.(day); return month },
        }),
      }
    },
    rpc: rpc ?? (async () => ({ error: null })),
  }
}

const stored = (sent: number): ReadResult => ({ data: { sent }, error: null })
const readError = (): ReadResult => ({ data: null, error: { message: 'connection reset' } })

afterEach(() => {
  delete process.env.EMAIL_DAILY_CAP
  delete process.env.EMAIL_TRANSACTIONAL_RESERVE
  delete process.env.EMAIL_MONTHLY_CAP
  delete process.env.EMAIL_MONTHLY_TRANSACTIONAL_RESERVE
  delete process.env.EMAIL_BILLING_DAY
  vi.restoreAllMocks()
})

describe('budget configuration', () => {
  it('defaults to 100/day with a 20 reserve (marketing cap 80)', () => {
    expect(dailyCap()).toBe(100)
    expect(transactionalReserve()).toBe(20)
    expect(marketingCap()).toBe(80)
  })

  it('is overridable from the environment', () => {
    process.env.EMAIL_DAILY_CAP = '50'
    process.env.EMAIL_TRANSACTIONAL_RESERVE = '10'
    expect(dailyCap()).toBe(50)
    expect(marketingCap()).toBe(40)
  })

  it('clamps the reserve below the cap so marketing always keeps a slot', () => {
    process.env.EMAIL_DAILY_CAP = '100'
    process.env.EMAIL_TRANSACTIONAL_RESERVE = '500'
    expect(transactionalReserve()).toBe(99)
    expect(marketingCap()).toBe(1)
  })

  it('keys the counter by UTC day', () => {
    expect(utcDay(new Date('2026-10-10T23:30:00Z'))).toBe('2026-10-10')
  })
})

describe('canSend — transactional is never blocked (fail-safe)', () => {
  it('allows transactional mail even when the day is at the hard cap', async () => {
    const db = quotaDb(stored(100))
    expect(await canSend('transactional', db as never)).toBe(true)
  })

  it('allows transactional mail even when the counter read fails', async () => {
    const db = quotaDb(readError())
    expect(await canSend('transactional', db as never)).toBe(true)
  })
})

describe('canSend — marketing is held back to protect the reserve', () => {
  it('allows marketing while the non-reserved budget remains', async () => {
    expect(await canSend('marketing', quotaDb(stored(79)) as never)).toBe(true)
  })

  it('refuses marketing once the non-reserved budget is spent, leaving the reserve', async () => {
    // 80 sent of a 100 cap / 20 reserve: marketing is done, 20 remain for
    // transactional only.
    expect(await canSend('marketing', quotaDb(stored(80)) as never)).toBe(false)
  })

  it('fails CLOSED for marketing when the counter read fails', async () => {
    expect(await canSend('marketing', quotaDb(readError()) as never)).toBe(false)
  })
})

describe('recordSend', () => {
  it('atomically bumps the day counter via the RPC, best-effort', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    await recordSend(quotaDb(stored(1), rpc) as never, new Date('2026-10-10T12:00:00Z'))
    expect(rpc).toHaveBeenCalledWith('bump_email_quota', { p_day: '2026-10-10' })
  })

  it('never throws when the increment errors (the mail already went out)', async () => {
    const rpc = vi.fn(async () => ({ error: { message: 'db down' } }))
    await expect(recordSend(quotaDb(stored(1), rpc) as never)).resolves.toBeUndefined()
  })
})

describe('plan without a daily cap (Resend Pro)', () => {
  it('reads "none", "off" and "0" as no daily cap, with no daily reserve', () => {
    for (const v of ['none', 'off', '0', ' None ']) {
      process.env.EMAIL_DAILY_CAP = v
      expect(dailyCap()).toBeNull()
      expect(marketingCap()).toBeNull()
      expect(transactionalReserve()).toBe(0)
    }
  })

  it('keeps the Free default when the value is unparseable', () => {
    process.env.EMAIL_DAILY_CAP = 'lots'
    expect(dailyCap()).toBe(100)
  })

  it('skips the day check entirely and lets marketing through below the monthly cap', async () => {
    process.env.EMAIL_DAILY_CAP = 'none'
    process.env.EMAIL_MONTHLY_CAP = '50000'
    // The day row would block under a daily cap; with none it is never read.
    const db = quotaDb(stored(10_000), undefined, { data: [{ sent: 10_000 }, { sent: 2_000 }], error: null })
    expect(await canSend('marketing', db as never)).toBe(true)
  })
})

describe('monthly cap', () => {
  it('defaults to Free (3,000) with a 10% transactional reserve', () => {
    expect(monthlyCap()).toBe(3000)
    expect(monthlyTransactionalReserve()).toBe(300)
    expect(monthlyMarketingCap()).toBe(2700)
  })

  it('follows EMAIL_MONTHLY_CAP and an explicit reserve, clamped below the cap', () => {
    process.env.EMAIL_MONTHLY_CAP = '50000'
    expect(monthlyMarketingCap()).toBe(45000)
    process.env.EMAIL_MONTHLY_TRANSACTIONAL_RESERVE = '999999'
    expect(monthlyTransactionalReserve()).toBe(49999)
    process.env.EMAIL_MONTHLY_CAP = 'none'
    expect(monthlyMarketingCap()).toBeNull()
  })

  it('refuses marketing once the month is spent, even with day budget left', async () => {
    process.env.EMAIL_MONTHLY_CAP = '1000'
    const db = quotaDb(stored(1), undefined, { data: [{ sent: 600 }, { sent: 300 }], error: null })
    expect(await canSend('marketing', db as never)).toBe(false)
  })

  it('never blocks transactional mail on the month', async () => {
    process.env.EMAIL_MONTHLY_CAP = '10'
    const db = quotaDb(stored(1), undefined, { data: [{ sent: 10 }], error: null })
    expect(await canSend('transactional', db as never)).toBe(true)
  })

  it('fails CLOSED for marketing when the monthly read fails', async () => {
    process.env.EMAIL_DAILY_CAP = 'none'
    const db = quotaDb(stored(0), undefined, { data: null, error: { message: 'timeout' } })
    expect(await canSend('marketing', db as never)).toBe(false)
  })

  it('sums from the billing period start', async () => {
    process.env.EMAIL_BILLING_DAY = '10'
    const seen: string[] = []
    await canSend('marketing', quotaDb(stored(0), undefined, undefined, (d) => seen.push(d)) as never, new Date('2026-11-23T12:00:00Z'))
    expect(seen).toEqual(['2026-11-10'])
  })
})

describe('billingPeriodStart', () => {
  it('is the 1st of the month by default', () => {
    expect(billingPeriodStart(new Date('2026-11-23T00:00:00Z'))).toBe('2026-11-01')
  })

  it('rolls back a month (and a year) before the billing day', () => {
    process.env.EMAIL_BILLING_DAY = '10'
    expect(billingPeriodStart(new Date('2026-11-09T23:59:00Z'))).toBe('2026-10-10')
    expect(billingPeriodStart(new Date('2027-01-05T00:00:00Z'))).toBe('2026-12-10')
    expect(billingPeriodStart(new Date('2026-11-10T00:00:00Z'))).toBe('2026-11-10')
  })

  it('ignores a billing day outside 1–28', () => {
    process.env.EMAIL_BILLING_DAY = '31'
    expect(billingPeriodStart(new Date('2026-11-23T00:00:00Z'))).toBe('2026-11-01')
  })
})
