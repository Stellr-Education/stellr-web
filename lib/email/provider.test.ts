import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeTransport, emailProvider, heldOnStandby } from './provider'
import { sesFrom } from './transport-ses'

afterEach(() => vi.unstubAllEnvs())

describe('provider switch', () => {
  it('is Resend unless EMAIL_PROVIDER says ses', () => {
    expect(emailProvider()).toBe('resend')
    vi.stubEnv('EMAIL_PROVIDER', ' SES ')
    expect(emailProvider()).toBe('ses')
  })
  it('holds only community mail on the standby', () => {
    expect(heldOnStandby('marketing')).toBe(false)
    vi.stubEnv('EMAIL_PROVIDER', 'ses')
    expect(heldOnStandby('marketing')).toBe(true)
    expect(heldOnStandby('transactional')).toBe(false)
  })
  it('picks the transport', () => {
    expect(activeTransport('re_x')?.name).toBe('resend')
    expect(activeTransport(undefined)).toBeNull()
    vi.stubEnv('EMAIL_PROVIDER', 'ses')
    expect(activeTransport(undefined)?.name).toBe('ses')
  })
})

describe('sesFrom', () => {
  it('keeps a From already on the SES identity', () => {
    expect(sesFrom('Stellr Education <no-reply@mail.stellreducation.org>')).toBe('Stellr Education <no-reply@mail.stellreducation.org>')
  })
  it('moves another domain onto it, naming the sender "via Stellr"', () => {
    expect(sesFrom('"Example Events" <events@mail.example.org>')).toBe('"Example Events via Stellr" <no-reply@mail.stellreducation.org>')
    expect(sesFrom('Stellr Education <hello@community.stellreducation.org>')).toBe('"Stellr Education" <no-reply@mail.stellreducation.org>')
    expect(sesFrom('x@example.org')).toBe('"Stellr Education" <no-reply@mail.stellreducation.org>')
  })
})
