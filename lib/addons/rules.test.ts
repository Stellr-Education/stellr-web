import { describe, expect, it } from 'vitest'
import { addonInputSchema, availability, formatAddonPrice, onSale, refundableNow, rowFromInput } from './rules'
import { addonDateLabel, addonFootnote, addonPriceLabel } from './display'

const now = new Date('2026-12-01T12:00:00Z')

describe('onSale', () => {
  it('needs on_sale status and the window', () => {
    expect(onSale({ status: 'on_sale', sale_opens_at: null, sale_closes_at: null }, now)).toBe(true)
    expect(onSale({ status: 'draft', sale_opens_at: null, sale_closes_at: null }, now)).toBe(false)
    expect(onSale({ status: 'closed', sale_opens_at: null, sale_closes_at: null }, now)).toBe(false)
    expect(onSale({ status: 'on_sale', sale_opens_at: '2026-12-02T00:00:00Z', sale_closes_at: null }, now)).toBe(false)
    expect(onSale({ status: 'on_sale', sale_opens_at: null, sale_closes_at: '2026-12-01T12:00:00Z' }, now)).toBe(false)
    expect(onSale({ status: 'on_sale', sale_opens_at: '2026-11-01T00:00:00Z', sale_closes_at: '2027-01-01T00:00:00Z' }, now)).toBe(true)
  })
})

describe('availability', () => {
  it('never needs a count to say what it says', () => {
    expect(availability(null, 999)).toBe('available')
    expect(availability(20, 10)).toBe('available')
    expect(availability(20, 15)).toBe('limited')
    expect(availability(20, 20)).toBe('sold_out')
    expect(availability(0, 0)).toBe('sold_out')
  })
})

describe('refundableNow', () => {
  it('follows the rule', () => {
    expect(refundableNow({ refund_rule: 'none', refund_until: null, sale_closes_at: null }, now)).toBe(false)
    expect(refundableNow({ refund_rule: 'event_policy', refund_until: null, sale_closes_at: null }, now)).toBe('event_policy')
    expect(refundableNow({ refund_rule: 'until_cutoff', refund_until: '2026-12-10T00:00:00Z', sale_closes_at: null }, now)).toBe(true)
    expect(refundableNow({ refund_rule: 'until_cutoff', refund_until: '2026-11-10T00:00:00Z', sale_closes_at: null }, now)).toBe(false)
    // No explicit date: the sales cut-off.
    expect(refundableNow({ refund_rule: 'until_cutoff', refund_until: null, sale_closes_at: '2026-11-30T00:00:00Z' }, now)).toBe(false)
    expect(refundableNow({ refund_rule: 'until_cutoff', refund_until: null, sale_closes_at: null }, now)).toBe(true)
  })
})

describe('addonInputSchema', () => {
  const night = { kind: 'accommodation', title: 'Friday night', priceCents: 9500, capacity: 40 }
  it('accepts a night and defaults it to group-only for minors', () => {
    const p = addonInputSchema.parse(night)
    const row = rowFromInput(p)
    expect(row.minors_group_only).toBe(true)
    expect(row.max_per_person).toBe(1)
    expect(row.store_product_id).toBeNull()
  })
  it('a tour is not group-only by default', () => {
    expect(rowFromInput(addonInputSchema.parse({ kind: 'experience', title: 'Tour', priceCents: 2000 })).minors_group_only).toBe(false)
  })
  it('needs a price for accommodation and experiences, and at least 50 cents if paid', () => {
    expect(addonInputSchema.safeParse({ kind: 'experience', title: 'Tour' }).success).toBe(false)
    expect(addonInputSchema.safeParse({ kind: 'experience', title: 'Tour', priceCents: 30 }).success).toBe(false)
    expect(addonInputSchema.safeParse({ kind: 'experience', title: 'Tour', priceCents: 0 }).success).toBe(true)
  })
  it('needs a product and sizes for merch, and drops any price or capacity', () => {
    expect(addonInputSchema.safeParse({ kind: 'merch', title: 'Hoodie' }).success).toBe(false)
    const p = addonInputSchema.parse({
      kind: 'merch',
      title: 'Hoodie',
      storeProductId: '0d6c6b9e-3f1a-4b1e-9a3a-1d2c3b4a5f60',
      variantIds: ['1d6c6b9e-3f1a-4b1e-9a3a-1d2c3b4a5f60'],
      priceCents: 999,
      capacity: 5,
    })
    const row = rowFromInput(p)
    expect(row.price_cents).toBeNull()
    expect(row.capacity).toBeNull()
    expect(row.max_per_person).toBe(10)
  })
  it('refuses dates and windows that run backwards', () => {
    expect(addonInputSchema.safeParse({ ...night, serviceDate: '2027-03-06', serviceEndDate: '2027-03-05' }).success).toBe(false)
    expect(addonInputSchema.safeParse({ ...night, saleOpensAt: '2027-01-02T00:00:00Z', saleClosesAt: '2027-01-01T00:00:00Z' }).success).toBe(false)
  })
})

describe('labels', () => {
  it('formats prices', () => {
    expect(formatAddonPrice(9500, 'usd')).toBe('$95')
    expect(formatAddonPrice(9550, 'usd')).toBe('$95.50')
    expect(formatAddonPrice(0, 'usd')).toBe('Free')
    expect(formatAddonPrice(4500, 'aud')).toBe('AUD 45')
    expect(addonPriceLabel({ kind: 'accommodation', priceCents: 9500, currency: 'usd', variants: [] })).toBe('$95 per person')
    expect(addonPriceLabel({ kind: 'experience', priceCents: 0, currency: 'usd', variants: [] })).toBe('Free')
    const v = (unitCents: number) => ({ variantId: 'v', sku: 's', label: 'M', unitCents })
    expect(addonPriceLabel({ kind: 'merch', priceCents: null, currency: 'usd', variants: [v(3800), v(4200)] })).toBe('From $38')
    expect(addonPriceLabel({ kind: 'merch', priceCents: null, currency: 'usd', variants: [v(3800), v(3800)] })).toBe('$38')
  })
  it('formats dates as calendar dates', () => {
    expect(addonDateLabel({ serviceDate: '2027-03-05', serviceEndDate: null })).toBe('Fri, Mar 5, 2027')
    expect(addonDateLabel({ serviceDate: null, serviceEndDate: null })).toBeNull()
    expect(addonDateLabel({ serviceDate: '2027-03-06', serviceEndDate: '2027-03-07' })).toBe('Sat, Mar 6, 2027 – Sun, Mar 7, 2027')
  })
  it('says who can book', () => {
    expect(addonFootnote({ minorsGroupOnly: true, audience: 'all' })).toMatch(/through their school or group/)
    expect(addonFootnote({ minorsGroupOnly: false, audience: 'adults' })).toBe('For adults only.')
    expect(addonFootnote({ minorsGroupOnly: false, audience: 'all' })).toBeNull()
  })
})
