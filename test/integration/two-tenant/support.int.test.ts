// S6-SUP-UI on a real database: what a support session reads (lib/support/read-view.ts)
// and the change break-glass makes (lib/support/break-glass-actions.ts). Run by CI's
// tenant-db job only (vitest.integration.config.mts), on the two-tenant kit.
//
// The app opens these through tenantSupportDb (tenant_support_ro, READ ONLY) and
// tenantBreakGlassDb (tenant_app), both pinned to the session's tenant. Here each runs on
// the kit's tenantDb for one tenant (tenant_app through the real driver: exactly the
// break-glass role, and for reads the same row policies tenant_support_ro has, which
// supabase/tests/database/support_sessions.test.sql holds equal). Proves:
//
//   - the support reads return only the pinned tenant's events and companies, in both
//     directions, and another tenant's event reads as empty;
//   - the break-glass rename lands on the pinned tenant's own company, and naming another
//     tenant's company changes nothing (0 rows), in both directions.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renameCompanyUnderBreakGlass } from '@/lib/support/break-glass-actions'
import { supportEventCompanies, supportEvents } from '@/lib/support/read-view'
import { openTwoTenantKit, type Seeded, type TwoTenantKit } from './kit'

let kit: TwoTenantKit
let seeded: Seeded

beforeAll(async () => {
  kit = await openTwoTenantKit()
  seeded = await kit.seed('event_companies', 'registrations', 'participants')
})

afterAll(async () => {
  await kit?.cleanup()
})

const pairs = () =>
  [
    [kit.stellr, kit.canary],
    [kit.canary, kit.stellr],
  ] as const

describe('the support reads', () => {
  it("list the pinned tenant's events only, in both directions", async () => {
    for (const [own, other] of pairs()) {
      const slugs = (await supportEvents(kit.asTenant(own.id))).map((e) => e.slug)
      expect(slugs).toContain(own.event.slug)
      expect(slugs).not.toContain(other.event.slug)
      expect(slugs).not.toContain(other.spare.slug)
    }
  })

  it('count registrations and participants on the own event', async () => {
    const row = (await supportEvents(kit.asTenant(kit.canary.id))).find((e) => e.slug === kit.canary.event.slug)
    expect(row?.registrations).toBeGreaterThanOrEqual(1)
    expect(row?.participants).toBeGreaterThanOrEqual(1)
  })

  it("read another tenant's event's companies as empty", async () => {
    for (const [own, other] of pairs()) {
      expect((await supportEventCompanies(kit.asTenant(own.id), own.event.slug)).map((c) => c.id)).toContain(seeded.event_companies[own.tag][0])
      expect(await supportEventCompanies(kit.asTenant(own.id), other.event.slug)).toEqual([])
    }
  })
})

describe('the break-glass rename', () => {
  const nameOf = async (id: string) => (await kit.admin<{ name: string | null }[]>`SELECT name FROM public.event_companies WHERE id = ${id}::uuid`)[0]?.name

  it("changes nothing when it names another tenant's company, in both directions", async () => {
    for (const [own, other] of pairs()) {
      const target = seeded.event_companies[other.tag][0] as string
      const before = await nameOf(target)
      expect(await renameCompanyUnderBreakGlass(kit.asTenant(own.id), other.event.slug, target, 'Taken')).toBe(0)
      expect(await nameOf(target)).toBe(before)
    }
  })

  it("renames the pinned tenant's own company, and clears it", async () => {
    for (const t of [kit.stellr, kit.canary]) {
      const id = seeded.event_companies[t.tag][0] as string
      expect(await renameCompanyUnderBreakGlass(kit.asTenant(t.id), t.event.slug, id, 'Comets')).toBe(1)
      expect(await nameOf(id)).toBe('Comets')
      expect(await renameCompanyUnderBreakGlass(kit.asTenant(t.id), t.event.slug, id, null)).toBe(1)
      expect(await nameOf(id)).toBeNull()
    }
  })
})
