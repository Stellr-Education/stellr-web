import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { loadStreamRates, ratesFor } from './events-health'

describe('ratesFor', () => {
  it('works out rates, and flags only over the line with enough sends', () => {
    expect(ratesFor('community', 'Community', { sent: 1000, delivered: 990, bounced: 40, complained: 0 }))
      .toMatchObject({ sent: 1000, bounceRate: 0.04, complaintRate: 0, alert: true })
    expect(ratesFor('community', 'Community', { sent: 1000, delivered: 990, bounced: 0, complained: 1 }).alert).toBe(true)
    expect(ratesFor('community', 'Community', { sent: 1000, delivered: 990, bounced: 39, complained: 0 }).alert).toBe(false)
    // Too few sends to mean anything.
    expect(ratesFor('community', 'Community', { sent: 50, delivered: 50, bounced: 10, complained: 1 }).alert).toBe(false)
    // Before email.sent is subscribed, delivered stands in for sent.
    expect(ratesFor(null, 'Untagged', { sent: 0, delivered: 300, bounced: 3, complained: 0 })).toMatchObject({ sent: 300, bounceRate: 0.01 })
    expect(ratesFor(null, 'Untagged', { sent: 0, delivered: 0, bounced: 0, complained: 0 })).toMatchObject({ bounceRate: null, alert: false })
  })
})

describe('loadStreamRates', () => {
  const NOW = new Date('2026-11-23T12:00:00Z')
  const row = (stream: string | null, type: string, occurred_at = '2026-11-22T00:00:00Z') => ({ stream, type, occurred_at })

  it('counts the last 7 days per stream and leaves out streams with no mail', async () => {
    const fake = fakeSupabase({
      email_events: [
        row('transactional', 'sent'), row('transactional', 'sent'), row('transactional', 'delivered'),
        row('transactional', 'bounced'),
        row(null, 'delivered'), row(null, 'complained'),
        row('transactional', 'sent', '2026-11-10T00:00:00Z'), // outside the window
      ],
    })
    const out = await loadStreamRates(fake.client, NOW)
    expect(out.map((r) => [r.label, r.sent, r.bounced, r.complained])).toEqual([
      ['Transactional', 2, 1, 0],
      ['Untagged', 1, 0, 1],
    ])
  })

  it('throws on a failed count', async () => {
    const fake = fakeSupabase({}, { failOn: () => 'down' })
    await expect(loadStreamRates(fake.client, NOW)).rejects.toThrow(/down/)
  })
})
