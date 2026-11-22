// The 'volunteers' area on a real database (multi-tenancy plan S5, A10c). Run by CI's
// tenant-db job only (vitest.integration.config.mts), on the two-tenant kit. Proves, through
// the real driver and the tenant row level security policies on volunteer_event_interest:
//
//   - an event's interest read returns only its own tenant's rows on both paths (the service
//     path's filter, as service_role, and the tenantDb read lib/events/admin-volunteers.ts
//     runs), and the two agree by the comparison the shadow mode uses, which leaves out the
//     members embed the tenant path cannot read;
//   - the read, called through the area switch in tenant mode exactly as the route calls it,
//     keeps to the caller's tenant: another tenant's event reads as empty;
//   - tenant_app cannot read members (the reason the tenant path carries no names);
//   - a write naming another tenant's event or row is refused or changes nothing, and lands
//     nothing; the same write on the tenant's own event lands, stamped with that tenant.

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { compareInterest, loadEventVolunteerInterest, tenantEventVolunteerInterest, type EventVolunteerInterestRow } from '@/lib/events/admin-volunteers'
import { FIXTURES } from '../../../scripts/gen-tenant-isolation-pgtap.mjs'
import { expectAreaIsolated, openTwoTenantKit, type KitTenant, type Seeded, type TwoTenantKit } from './kit'

let kit: TwoTenantKit
let seeded: Seeded

/** The member the matrix's fixture names (scripts/gen-tenant-isolation-pgtap.mjs, MEMBER). */
const MEMBER = 'c0000000-0000-4000-8000-000000000001'

beforeAll(async () => {
  kit = await openTwoTenantKit()
  // The fixture's member: the pgTAP run inserts it inside its rolled-back transaction, so
  // the kit's database does not hold it.
  const fixture = (FIXTURES as Record<string, (c: unknown) => Record<string, string>>)['public.volunteer_event_interest']
  expect(fixture({ ev: { slug: 'x' } }).member_id).toBe(`'${MEMBER}'`)
  await kit.admin`
    INSERT INTO public.members (id, first_name, last_name, email, event_role)
    VALUES (${MEMBER}, 'Iso', 'Member', 'iso-member@example.test', 'participant')
    ON CONFLICT (id) DO NOTHING`
  seeded = await kit.seed('volunteer_event_interest')
})

afterAll(async () => {
  // Deleting the member cascades to every interest row it holds, the kit's included.
  if (!kit) return
  await kit.admin`DELETE FROM public.members WHERE id = ${MEMBER}`.catch(() => {})
  await kit.cleanup()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** The route's service client: tenant mode must never reach it. */
const noService = new Proxy(
  {},
  {
    get() {
      throw new Error('the service path ran in tenant mode')
    },
  },
) as unknown as SupabaseClient

/** Turn the area to tenant mode for this process, on the kit's local login. */
function tenantMode() {
  for (const [k, v] of Object.entries(kit.env)) vi.stubEnv(k, v)
  // TENANT_DB_AREAS (lib/tenancy/area-switch.ts), named here so this file stays off its importers.
  vi.stubEnv('TENANT_DB_AREAS', 'volunteers:tenant')
}

const tenantOf = (id: string): KitTenant => (id === kit.stellr.id ? kit.stellr : kit.canary)

/** The rows' own ids, for the kit (which matches on `id`); the area itself keys by member_id. */
type Keyed = EventVolunteerInterestRow & { id: string }

/** The service path's filter as service_role: today's supabase-js query, by the event's slug. */
const serviceInterest = (sql: Parameters<Parameters<TwoTenantKit['service']>[0]>[0], slug: string) =>
  sql<Keyed[]>`
    SELECT v.id::text AS id, v.member_id::text AS member_id, v.created_at,
      json_build_object('id', m.id, 'first_name', m.first_name, 'last_name', m.last_name,
        'email', m.email, 'date_of_birth', m.date_of_birth) AS members
    FROM public.volunteer_event_interest v JOIN public.members m ON m.id = v.member_id
    WHERE v.event_slug = ${slug} AND v.status = 'interested'
    ORDER BY v.created_at ASC`

const interestOn = async (slug: string) =>
  kit.admin<{ id: string; status: string; tenant_id: string | null }[]>`
    SELECT id::text AS id, status, tenant_id::text AS tenant_id
    FROM public.volunteer_event_interest WHERE event_slug = ${slug} ORDER BY id`

describe('the interest read', () => {
  it('returns only its own tenant’s rows on both paths, and the paths agree', async () => {
    const idOf = async (slug: string) => (await interestOn(slug)).map((r) => r.id)
    await expectAreaIsolated<Keyed>(kit, {
      service: (sql, tenantId) => serviceInterest(sql, tenantOf(tenantId).event.slug),
      // The tenant path carries no row id; the kit matches by id, so it is read back here by
      // the owner from the row the tenant path returned (member and event pick one row).
      tenant: async (db) => {
        const slug = tenantOf(db.tenantId).event.slug
        const rows = await tenantEventVolunteerInterest(db, slug)
        const ids = await idOf(slug)
        expect(rows.length).toBe(ids.length)
        return rows.map((r, i) => ({ ...r, id: ids[i] }))
      },
      normalise: (r) => compareInterest.normalise(r),
      expected: seeded.volunteer_event_interest,
    })
  })

  it("tenantDb finds nothing on the other tenant's event, in both directions", async () => {
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      expect(await tenantEventVolunteerInterest(kit.asTenant(me.id), other.event.slug)).toEqual([])
      expect((await tenantEventVolunteerInterest(kit.asTenant(me.id), me.event.slug)).map((r) => r.member_id)).toEqual([MEMBER])
    }
  })

  it('tenant_app has no read on members: the reason the tenant path carries no names', async () => {
    await expect(kit.asTenant(kit.canary.id).sql`SELECT id FROM public.members LIMIT 1`).rejects.toMatchObject({ code: '42501' })
  })

  it('through the area switch in tenant mode, the route’s own call keeps to the caller’s tenant', async () => {
    tenantMode()
    const own = await loadEventVolunteerInterest(noService, kit.canary.id, kit.canary.event.slug)
    expect(own.map((r) => r.member_id)).toEqual([MEMBER])
    expect(own[0]).not.toHaveProperty('members')
    expect(await loadEventVolunteerInterest(noService, kit.canary.id, kit.stellr.event.slug)).toEqual([])
    expect(await loadEventVolunteerInterest(noService, kit.stellr.id, kit.canary.event.slug)).toEqual([])
  })
})

describe('writes as tenant_app', () => {
  it("an insert naming the other tenant's event is refused, and nothing lands", async () => {
    for (const [me, other] of [
      [kit.canary, kit.stellr],
      [kit.stellr, kit.canary],
    ] as const) {
      await expect(
        kit.asTenant(me.id).sql`
          INSERT INTO public.volunteer_event_interest (member_id, event_slug, event_title)
          VALUES (${MEMBER}::uuid, ${other.spare.slug}, 'Iso')`,
      ).rejects.toThrow()
      expect(await interestOn(other.spare.slug)).toEqual([])
    }
  })

  it("an update or delete naming the other tenant's row changes nothing", async () => {
    const before = await interestOn(kit.stellr.event.slug)
    const target = seeded.volunteer_event_interest.stellr[0] as string
    const db = kit.asTenant(kit.canary.id)
    expect(await db.sql`UPDATE public.volunteer_event_interest SET status = 'withdrawn' WHERE id = ${target}::uuid RETURNING id`).toEqual([])
    expect(await db.sql`DELETE FROM public.volunteer_event_interest WHERE id = ${target}::uuid RETURNING id`).toEqual([])
    expect(await interestOn(kit.stellr.event.slug)).toEqual(before)
  })

  it("on the tenant's own event the same insert lands, stamped with that tenant, and the read sees it", async () => {
    tenantMode()
    for (const t of [kit.stellr, kit.canary]) {
      await kit.asTenant(t.id).sql`
        INSERT INTO public.volunteer_event_interest (member_id, event_slug, event_title)
        VALUES (${MEMBER}::uuid, ${t.spare.slug}, 'Iso')`
      expect((await interestOn(t.spare.slug)).map((r) => [r.status, r.tenant_id])).toEqual([['interested', t.id]])
      expect((await loadEventVolunteerInterest(noService, t.id, t.spare.slug)).map((r) => r.member_id)).toEqual([MEMBER])
    }
  })
})
