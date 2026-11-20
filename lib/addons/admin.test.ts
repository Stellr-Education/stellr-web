import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { manifestCsv, payerWords, type StaffLine } from './admin'

const line = (over: Partial<StaffLine>): StaffLine => ({
  id: 'l', addonId: 'a', addonTitle: 'SpaceX tour', addonKind: 'experience', participantId: 'p', firstName: 'Ana', lastName: 'Bell',
  adult: false, dateOfBirth: '2011-05-01', registrationId: 'r', registrationType: 'group', group: 'Waco High', leadName: 'Teacher One',
  quantity: 1, unitPriceCents: 2000, currency: 'usd', payer: 'self', groupMethod: null, status: 'confirmed', checkedAt: null, variantId: null, ...over,
})

describe('manifestCsv (US-7)', () => {
  it('lists live lines with the minimum a provider needs, and nothing medical or contact', () => {
    const csv = manifestCsv(
      [line({}), line({ id: 'x', firstName: 'Cal', lastName: 'Dee', status: 'cancelled' }), line({ id: 'y', firstName: 'Eve', lastName: 'Fox', adult: true, dateOfBirth: '1985-01-01', status: 'pending_payment' })],
      '2027-03-07',
    )
    const rows = csv.trim().split(/\r?\n/)
    expect(rows[0]).toBe('First name,Last name,Adult or student,Age at the event,Group,Group lead,Quantity,Status')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toBe('Ana,Bell,Student,15,Waco High,Teacher One,1,Booked')
    expect(rows[2]).toContain('Eve,Fox,Adult,42')
    expect(rows[2]).toContain('Not yet paid')
    expect(csv).not.toMatch(/Cal/)
  })
  it('says individual for an individual registration', () => {
    expect(manifestCsv([line({ group: null, registrationType: 'individual', leadName: null })], null)).toContain('Ana,Bell,Student,,Individual,,1,Booked')
  })
})

describe('payerWords', () => {
  it('names how each line is paid', () => {
    expect(payerWords({ payer: 'group', groupMethod: 'invoice' })).toBe('Group invoice')
    expect(payerWords({ payer: 'group', groupMethod: 'card' })).toBe('Group card')
    expect(payerWords({ payer: 'included', groupMethod: null })).toBe('Waived')
  })
})
