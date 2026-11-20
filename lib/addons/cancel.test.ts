import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { lineRefundable } from './cancel'

const addon = (over: Record<string, unknown> = {}) => ({
  id: 'a', event_slug: 'e', kind: 'accommodation' as const, title: 'Friday night',
  refund_rule: 'until_cutoff' as const, refund_until: '2027-02-15T00:00:00Z', sale_closes_at: '2027-02-20T00:00:00Z', ...over,
})
const now = new Date('2027-02-01T00:00:00Z')

describe('lineRefundable (Q8)', () => {
  it('until the refund date, then not', () => {
    expect(lineRefundable({ paid_at: '2026-12-01T00:00:00Z', addon: addon() }, { reason: 'member', merchCommitted: false, now })).toBe(true)
    expect(lineRefundable({ paid_at: '2026-12-01T00:00:00Z', addon: addon() }, { reason: 'member', merchCommitted: false, now: new Date('2027-02-16T00:00:00Z') })).toBe(false)
  })
  it('falls back to the sales cut-off when no refund date is set', () => {
    const a = addon({ refund_until: null })
    expect(lineRefundable({ paid_at: null, addon: a }, { reason: 'member', merchCommitted: false, now: new Date('2027-02-19T00:00:00Z') })).toBe(true)
    expect(lineRefundable({ paid_at: null, addon: a }, { reason: 'member', merchCommitted: false, now: new Date('2027-02-21T00:00:00Z') })).toBe(false)
  })
  it('never, for a non-refundable add-on, unless the event is cancelled', () => {
    const a = addon({ refund_rule: 'none' })
    expect(lineRefundable({ paid_at: '2027-01-30T00:00:00Z', addon: a }, { reason: 'withdrawn', merchCommitted: false, now })).toBe(false)
    expect(lineRefundable({ paid_at: '2027-01-30T00:00:00Z', addon: a }, { reason: 'event_cancelled', merchCommitted: false, now })).toBe(true)
  })
  it('follows the 45-day guarantee on "event policy"', () => {
    const a = addon({ refund_rule: 'event_policy' })
    expect(lineRefundable({ paid_at: '2027-01-01T00:00:00Z', addon: a }, { reason: 'member', merchCommitted: false, now })).toBe(true)
    expect(lineRefundable({ paid_at: '2026-11-01T00:00:00Z', addon: a }, { reason: 'member', merchCommitted: false, now })).toBe(false)
  })
  it('merch until the merch order is committed', () => {
    const a = addon({ kind: 'merch', refund_rule: 'none' })
    expect(lineRefundable({ paid_at: '2027-01-30T00:00:00Z', addon: a }, { reason: 'member', merchCommitted: false, now })).toBe(true)
    expect(lineRefundable({ paid_at: '2027-01-30T00:00:00Z', addon: a }, { reason: 'member', merchCommitted: true, now })).toBe(false)
  })
})
