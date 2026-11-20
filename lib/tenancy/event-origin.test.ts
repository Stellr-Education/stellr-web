import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('the default client was used') } }))

import { eventSiteOrigin, originOnHost } from './event-origin'
import { STELLR_TENANT_ID } from './constants'
import { checkInCodeLink, checkInCodeUrl } from '@/lib/check-in-codes'

const CANARY = '00000000-0000-4000-8000-0000000ca4a2'
const SITE = 'https://www.stellreducation.org'
const ON = { TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.devzone.stellreducation.org' }

/** events answers `owner`; tenant_domains answers `primary`. Counts every read. */
function fakeDb(owner: { tenant_id: string | null } | null | 'error', primary: { host: string } | null | 'error' = null) {
  const reads: string[] = []
  const db = {
    from(table: string) {
      reads.push(table)
      const answer = table === 'events' ? owner : primary
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => (answer === 'error' ? { data: null, error: { message: 'down' } } : { data: answer, error: null }),
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { db, reads }
}

describe('eventSiteOrigin (S5 wave 8, A12)', () => {
  it('routing off: SITE_URL with no read at all, so Stellr links are byte-identical', async () => {
    const { db, reads } = fakeDb({ tenant_id: CANARY }, { host: 'canary.devzone.stellreducation.org' })
    expect(await eventSiteOrigin('any-event', { db, env: {}, siteUrl: SITE })).toBe(SITE)
    expect(reads).toEqual([])
  })

  it('routing on: a Stellr event, or one the mirror lacks, is SITE_URL', async () => {
    expect(await eventSiteOrigin('e', { db: fakeDb({ tenant_id: STELLR_TENANT_ID }).db, env: ON, siteUrl: SITE })).toBe(SITE)
    expect(await eventSiteOrigin('e', { db: fakeDb(null).db, env: ON, siteUrl: SITE })).toBe(SITE)
  })

  it('routing on: another tenant’s event opens on that tenant’s primary host', async () => {
    const { db } = fakeDb({ tenant_id: CANARY }, { host: 'canary.devzone.stellreducation.org' })
    expect(await eventSiteOrigin('e', { db, env: ON, siteUrl: SITE })).toBe('https://canary.devzone.stellreducation.org')
  })

  it('answers null, so no link is built, for a tenant with no active primary host or any failed read', async () => {
    expect(await eventSiteOrigin('e', { db: fakeDb({ tenant_id: CANARY }, null).db, env: ON, siteUrl: SITE })).toBeNull()
    expect(await eventSiteOrigin('e', { db: fakeDb({ tenant_id: CANARY }, 'error').db, env: ON, siteUrl: SITE })).toBeNull()
    expect(await eventSiteOrigin('e', { db: fakeDb('error').db, env: ON, siteUrl: SITE })).toBeNull()
  })

  it('keeps SITE_URL’s protocol and port when it swaps the host', () => {
    expect(originOnHost('canary-academy.localhost', 'http://localhost:3000')).toBe('http://canary-academy.localhost:3000')
    expect(originOnHost('canary.devzone.stellreducation.org', SITE)).toBe('https://canary.devzone.stellreducation.org')
  })
})

describe('check-in links take the origin', () => {
  it('build on the origin given, default SITE_URL, and none for a null origin', () => {
    vi.stubEnv('CREDENTIAL_LINK_SECRET', 'placeholder-check-in-secret-for-tests-0123456789')
    const onStellr = checkInCodeLink('nevada-sdc', 'p', '11111111-1111-4111-8111-111111111111')
    const onTenant = checkInCodeLink('nevada-sdc', 'p', '11111111-1111-4111-8111-111111111111', 'https://canary.devzone.stellreducation.org')
    expect(onTenant?.startsWith('https://canary.devzone.stellreducation.org/check-in/nevada-sdc/code?c=')).toBe(true)
    expect(onStellr?.endsWith(onTenant!.slice('https://canary.devzone.stellreducation.org'.length))).toBe(true)
    expect(checkInCodeLink('nevada-sdc', 'p', '11111111-1111-4111-8111-111111111111', null)).toBeNull()
    expect(checkInCodeUrl('e', 'p.x.y', 'https://h.example')).toBe('https://h.example/check-in/e/code?c=p.x.y')
    vi.unstubAllEnvs()
  })
})
