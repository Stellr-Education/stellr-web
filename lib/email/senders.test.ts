import { afterEach, describe, expect, it, vi } from 'vitest'
import { addressOf, domainOf, onCommunityDomain, streamForKind, streamFrom } from './senders'

afterEach(() => vi.unstubAllEnvs())

describe('sender registry', () => {
  it('maps budget kinds to streams', () => {
    expect(streamForKind('transactional')).toBe('transactional')
    expect(streamForKind('marketing')).toBe('community')
  })

  it('defaults both streams to mail.stellreducation.org until COMMUNITY_FROM is set', () => {
    vi.stubEnv('TRANSACTIONAL_FROM', '')
    vi.stubEnv('COMMUNITY_FROM', '')
    vi.stubEnv('MARKETING_FROM', '')
    expect(domainOf(streamFrom('transactional'))).toBe('mail.stellreducation.org')
    expect(domainOf(streamFrom('community'))).toBe('mail.stellreducation.org')
  })

  it('prefers COMMUNITY_FROM, then MARKETING_FROM, for the community stream', () => {
    vi.stubEnv('MARKETING_FROM', 'Stellr <hello@legacy.example.org>')
    expect(addressOf(streamFrom('community'))).toBe('hello@legacy.example.org')
    vi.stubEnv('COMMUNITY_FROM', 'Stellr <hello@community.example.org>')
    expect(addressOf(streamFrom('community'))).toBe('hello@community.example.org')
  })

  it('moves a named sender onto the community domain, keeping the name and local part', () => {
    vi.stubEnv('COMMUNITY_FROM', 'Stellr <hello@community.example.org>')
    expect(onCommunityDomain('David Shaw, Stellr Education <hello@mail.example.org>')).toBe('David Shaw, Stellr Education <hello@community.example.org>')
    expect(onCommunityDomain('events@mail.example.org')).toBe('events@community.example.org')
  })
})
