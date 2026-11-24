import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkSenderFields, checkSendingDomain, domainLimit } from './tenant-settings'

afterEach(() => vi.unstubAllEnvs())

describe('checkSendingDomain', () => {
  it('normalises what an admin types', () => {
    expect(checkSendingDomain('  https://Mail.Example.org/ ')).toEqual({ ok: true, value: 'mail.example.org' })
    expect(checkSendingDomain('mail.example.org.')).toEqual({ ok: true, value: 'mail.example.org' })
  })
  it('refuses non-domains and anything that would break a header', () => {
    for (const bad of ['', 'localhost', 'mail example.org', 'evil.org>, x@y', 'a@b.org', 42]) {
      expect(checkSendingDomain(bad).ok).toBe(false)
    }
  })
  it("never lets a tenant send as Stellr", () => {
    expect(checkSendingDomain('stellreducation.org').ok).toBe(false)
    expect(checkSendingDomain('mail.stellreducation.org').ok).toBe(false)
    expect(checkSendingDomain('notstellreducation.org').ok).toBe(true)
  })
})

describe('checkSenderFields', () => {
  it('cleans the name and lower-cases the local part', () => {
    expect(checkSenderFields({ from_name: '  Example  "Events" ', from_local_part: 'Events', reply_to: 'office@example.org' }))
      .toEqual({ ok: true, value: { from_name: 'Example Events', from_local_part: 'events', reply_to: 'office@example.org' } })
  })
  it('clears the name and reply-to with null or empty', () => {
    expect(checkSenderFields({ from_name: '', reply_to: null })).toEqual({ ok: true, value: { from_name: null, reply_to: null } })
  })
  it('refuses a bad local part or reply-to, and ignores unknown keys', () => {
    expect(checkSenderFields({ from_local_part: 'a b' }).ok).toBe(false)
    expect(checkSenderFields({ reply_to: 'not-an-email' }).ok).toBe(false)
    expect(checkSenderFields({ sending_domain: 'x.org', marketing_paused_at: null })).toEqual({ ok: true, value: {} })
  })
})

describe('domainLimit', () => {
  it('defaults to Resend Pro (10), two of them Stellr’s', () => {
    expect(domainLimit()).toEqual({ limit: 10, platform: 2 })
    vi.stubEnv('RESEND_DOMAIN_LIMIT', '1000')
    expect(domainLimit().limit).toBe(1000)
  })
})
