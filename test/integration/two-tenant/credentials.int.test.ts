// The 'credentials' area on a real database (multi-tenancy plan S5, A10c). Run by CI's
// tenant-db job only (vitest.integration.config.mts), on the two-tenant kit. Proves, through
// the real driver and the tenant row level security policies on credentials, event_settings,
// registrations and participants:
//
//   - an event's issued-credentials list returns only its own tenant's rows on both paths (the
//     service path's filter, as service_role, and the tenantDb read lib/events/admin-credentials.ts
//     runs), and the two paths agree by the comparison the shadow mode uses;
//   - through the area switch in tenant mode, exactly as the routes call them, the list, the
//     tenant panel and revoke keep to the caller's tenant: another tenant's event reads as
//     empty, a revoke naming another tenant's credential changes nothing, and a credential
//     written onto another tenant's event is refused by the database;
//   - on the tenant's own event the panel reads its rows and the revoke lands.

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StellrOnlyDb } from '@/lib/events/admin-records'
import {
  listEventCredentials,
  loadTenantCredentialPanel,
  revokeEventCredential,
  tenantEventCredentials,
  tenantRevokeCredential,
} from '@/lib/events/admin-credentials'
import { CREDENTIAL_COLUMNS, type CredentialRow } from '@/lib/credentials'
import { expectAreaIsolated, openTwoTenantKit, type KitTag, type KitTenant, type Seeded, type TwoTenantKit } from './kit'

let kit: TwoTenantKit
let seeded: Seeded
/** Per tenant: the event credentials this file wrote (participation, then mentor). */
const issued: Record<KitTag, { participation: string; mentor: string }> = {
  stellr: { participation: '', mentor: '' },
  canary: { participation: '', mentor: '' },
}

beforeAll(async () => {
  kit = await openTwoTenantKit()
  // The seeded credential is a 'manual' one on each event: the list must leave it out.
  seeded = await kit.seed('event_settings', 'registrations', 'participants', 'credentials')
  for (const t of [kit.stellr, kit.canary]) {
    const participant = seeded.participants[t.tag][0] as string
    // As the owner: the derivation trigger stamps each row with its event's tenant.
    const [p] = await kit.admin<{ id: string }[]>`
      INSERT INTO public.credentials (number, source, participant_id, event_slug, recipient_name, title, award_type)
      VALUES (${`ISO-A10C-${t.tag}-P`}, 'event', ${participant}, ${t.event.slug}, 'Iso Participant', 'Iso', 'participation')
      RETURNING id::text AS id`
    const [m] = await kit.admin<{ id: string }[]>`
      INSERT INTO public.credentials (number, source, event_slug, recipient_name, title, award_type)
      VALUES (${`ISO-A10C-${t.tag}-M`}, 'event', ${t.event.slug}, 'Iso Mentor', 'Iso', 'mentor')
      RETURNING id::text AS id`
    issued[t.tag] = { participation: p.id, mentor: m.id }
    await kit.admin`UPDATE public.participants SET checked_in_at = now() WHERE id = ${participant}`
    await kit.admin`UPDATE public.event_settings SET mentor_credential_title = ${`Iso mentor ${t.tag}`} WHERE event_slug = ${t.event.slug}`
  }
})

afterAll(async () => {
  await kit?.cleanup()
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
) as unknown as SupabaseClient & StellrOnlyDb

/** Turn the area to tenant mode for this process, on the kit's local login. */
function tenantMode() {
  for (const [k, v] of Object.entries(kit.env)) vi.stubEnv(k, v)
  // TENANT_DB_AREAS (lib/tenancy/area-switch.ts), named here so this file stays off its importers.
  vi.stubEnv('TENANT_DB_AREAS', 'credentials:tenant')
}

const tenantOf = (id: string): KitTenant => (id === kit.stellr.id ? kit.stellr : kit.canary)

const statusOf = async (id: string) => {
  const [row] = await kit.admin<{ status: string; revoked_reason: string | null; tenant_id: string }[]>`
    SELECT status, revoked_reason, tenant_id::text AS tenant_id FROM public.credentials WHERE id = ${id}`
  return row
}

describe('the issued-credentials list', () => {
  it('returns only its own tenant’s rows on both paths, and the paths agree', async () => {
    await expectAreaIsolated<CredentialRow>(kit, {
      // The service path's filter as service_role: today's supabase-js query (students).
      service: async (sql, tenantId) => {
        // CREDENTIAL_COLUMNS is a fixed constant; the slug is bound.
        const rows = await sql.unsafe<{ row: CredentialRow }[]>(
          `SELECT row_to_json(c) AS row FROM (
             SELECT ${CREDENTIAL_COLUMNS} FROM public.credentials
             WHERE event_slug = $1 AND source = 'event' AND award_type <> 'mentor'
           ) c ORDER BY c.recipient_name`,
          [tenantOf(tenantId).event.slug],
        )
        return rows.map(({ row }) => row)
      },
      tenant: (db) => tenantEventCredentials(db, tenantOf(db.tenantId).event.slug, 'students'),
      expected: { stellr: [issued.stellr.participation], canary: [issued.canary.participation] },
    })
  })

  it("tenantDb finds nothing on the other tenant's event, in both directions, for either audience", async () => {
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      for (const audience of ['students', 'mentors'] as const) {
        expect(await tenantEventCredentials(kit.asTenant(me.id), other.event.slug, audience)).toEqual([])
      }
      expect((await tenantEventCredentials(kit.asTenant(me.id), me.event.slug, 'mentors')).map((r) => r.id)).toEqual([issued[me.tag].mentor])
    }
  })

  it('through the area switch in tenant mode, the route’s own call keeps to the caller’s tenant', async () => {
    tenantMode()
    const own = await listEventCredentials(noService, kit.canary.id, kit.canary.event.slug, 'students')
    expect(own.map((r) => r.id)).toEqual([issued.canary.participation])
    expect(own[0]).toMatchObject({ number: 'ISO-A10C-canary-P', source: 'event', award_type: 'participation', skills: [] })
    expect(await listEventCredentials(noService, kit.canary.id, kit.stellr.event.slug, 'students')).toEqual([])
    expect(await listEventCredentials(noService, kit.stellr.id, kit.canary.event.slug, 'mentors')).toEqual([])
  })
})

describe('the tenant panel, through the area switch in tenant mode', () => {
  it("reads the tenant's own event: its wording, its list and its checked-in count", async () => {
    tenantMode()
    const panel = await loadTenantCredentialPanel(kit.canary.id, kit.canary.event.slug, 'mentors')
    expect(panel.settings).toMatchObject({ credential_title: 'Iso mentor canary' })
    expect(panel.credentials.map((r) => r.id)).toEqual([issued.canary.mentor])
    expect(panel.checkedInCount).toBe(1)
  })

  it("on the other tenant's event: no wording, no credentials, no count", async () => {
    tenantMode()
    expect(await loadTenantCredentialPanel(kit.canary.id, kit.stellr.event.slug, 'mentors')).toEqual({
      settings: null,
      credentials: [],
      checkedInCount: 0,
    })
  })
})

describe('the writes', () => {
  it("a revoke naming the other tenant's credential changes nothing, in both directions", async () => {
    tenantMode()
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      const target = issued[other.tag].participation
      const before = await statusOf(target)
      expect(await revokeEventCredential(noService, me.id, target, 'Taken', null)).toBeNull()
      expect(await tenantRevokeCredential(kit.asTenant(me.id), target, 'Taken', null, new Date().toISOString())).toBeNull()
      expect(await statusOf(target)).toEqual(before)
    }
  })

  it("a credential written onto the other tenant's event is refused by the database, and nothing lands", async () => {
    const db = kit.asTenant(kit.canary.id)
    await expect(
      db.sql`INSERT INTO public.credentials (tenant_id, number, source, event_slug, recipient_name, title, award_type)
             VALUES (${kit.stellr.id}::uuid, 'ISO-A10C-cross', 'event', ${kit.stellr.event.slug}, 'Iso', 'Iso', 'participation')`,
    ).rejects.toThrow()
    await expect(
      db.sql`INSERT INTO public.credentials (tenant_id, number, source, event_slug, recipient_name, title, award_type)
             VALUES (${kit.canary.id}::uuid, 'ISO-A10C-cross', 'event', ${kit.stellr.event.slug}, 'Iso', 'Iso', 'participation')`,
    ).rejects.toThrow()
    const [{ n }] = await kit.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM public.credentials WHERE number = 'ISO-A10C-cross'`
    expect(n).toBe(0)
  })

  it("on the tenant's own credential the revoke lands, once, keeping its tenant", async () => {
    tenantMode()
    for (const t of [kit.stellr, kit.canary]) {
      const id = issued[t.tag].mentor
      const row = await revokeEventCredential(noService, t.id, id, 'No-show', null)
      expect(row).toMatchObject({ id, status: 'revoked', revoked_reason: 'No-show' })
      expect(await statusOf(id)).toEqual({ status: 'revoked', revoked_reason: 'No-show', tenant_id: t.id })
      // Already revoked: null, which the route answers as its 409.
      expect(await revokeEventCredential(noService, t.id, id, 'Again', null)).toBeNull()
    }
  })
})
