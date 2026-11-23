import { describe, expect, it } from 'vitest'
import { consentStatus } from './consent-status'

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0)
const later = new Date(NOW + 3_600_000).toISOString()
const past = new Date(NOW - 1).toISOString()
const at = new Date(NOW - 60_000).toISOString()
const base = { expires_at: later, approved_at: null, declined_at: null, withdrawn_at: null, used_at: null }

describe('consentStatus', () => {
  it('reads each state, final ones first', () => {
    expect(consentStatus(base, NOW)).toBe('pending')
    expect(consentStatus({ ...base, approved_at: at }, NOW)).toBe('approved')
    expect(consentStatus({ ...base, declined_at: at }, NOW)).toBe('declined')
    expect(consentStatus({ ...base, approved_at: at, withdrawn_at: at }, NOW)).toBe('withdrawn')
    expect(consentStatus({ ...base, approved_at: at, used_at: at, expires_at: past }, NOW)).toBe('used')
    expect(consentStatus({ ...base, expires_at: past }, NOW)).toBe('lapsed')
    expect(consentStatus({ ...base, approved_at: at, expires_at: past }, NOW)).toBe('lapsed')
  })
})
