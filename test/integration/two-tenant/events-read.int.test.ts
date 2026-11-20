// The 'events-read' area on a real database (multi-tenancy plan S5, C8-PG callers, wave 8).
// Run by CI's tenant-db job only (vitest.integration.config.mts), on the two-tenant kit.
// Proves, through the real driver and the tenant row level security policy on public.events:
//
//   - each tenantDb read in lib/events/tenant-facade.ts returns its own tenant's events only:
//     another tenant's slug or Sanity id is simply absent;
//   - the getters, in tenant mode exactly as the callers call them, answer from the mirror
//     for the tenant passed in, and never for another.
//
// The service path is Sanity (lib/events/repo.ts), which this database job cannot reach, so it
// is not compared here; lib/events/tenant-facade.test.ts holds it.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  getEventBySlugIn,
  getEventsByIdsIn,
  getEventsBySlugsIn,
  tenantEventBySlug,
  tenantEventsByIds,
  tenantEventsBySlugs,
} from '@/lib/events/tenant-facade'
import { openTwoTenantKit, type TwoTenantKit } from './kit'

let kit: TwoTenantKit

beforeAll(async () => {
  kit = await openTwoTenantKit()
})

afterAll(async () => {
  await kit?.cleanup()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Turn the area to tenant mode for this process, on the kit's local login. */
function tenantMode() {
  for (const [k, v] of Object.entries(kit.env)) vi.stubEnv(k, v)
  // TENANT_DB_AREAS (lib/tenancy/area-switch.ts), named here so this file stays off its importers.
  vi.stubEnv('TENANT_DB_AREAS', 'events-read:tenant')
}

describe('the tenantDb reads', () => {
  it('find a tenant’s own event by slug, and nothing for another tenant’s', async () => {
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      const db = kit.asTenant(me.id)
      expect((await tenantEventBySlug(db, me.event.slug))?.slug.current, `${me.tag} own`).toBe(me.event.slug)
      expect(await tenantEventBySlug(db, other.event.slug), `${me.tag} reading ${other.tag}`).toBeNull()
    }
  })

  it('list by slugs and by Sanity ids within the tenant only', async () => {
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      const db = kit.asTenant(me.id)
      const slugs = (await tenantEventsBySlugs(db, [me.event.slug, other.event.slug])).map((e) => e.slug.current)
      expect(slugs, `${me.tag} by slugs`).toEqual([me.event.slug])
      const ids = (await tenantEventsByIds(db, [me.event.sanity, other.event.sanity])).map((e) => e._id)
      expect(ids, `${me.tag} by ids`).toEqual([me.event.sanity])
    }
  })
})

describe('the getters in tenant mode', () => {
  it('answer from the mirror for the tenant passed in, never for another', async () => {
    tenantMode()
    const { stellr, canary } = kit
    expect((await getEventBySlugIn(canary.id, canary.event.slug))?.slug.current).toBe(canary.event.slug)
    expect(await getEventBySlugIn(canary.id, stellr.event.slug)).toBeNull()
    expect((await getEventsBySlugsIn(stellr.id, [stellr.event.slug, canary.event.slug])).map((e) => e.slug.current)).toEqual([stellr.event.slug])
    expect((await getEventsByIdsIn(canary.id, [stellr.event.sanity, canary.event.sanity])).map((e) => e._id)).toEqual([canary.event.sanity])
  })
})
