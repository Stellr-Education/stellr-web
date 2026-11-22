// The 'team-profiles' area on a real database (multi-tenancy plan S5, A10c). Run by CI's
// tenant-db job only (vitest.integration.config.mts), on the two-tenant kit. Proves, through
// the real driver and the tenant row level security policies:
//
//   - the admin team-profile plan returns only its own tenant's students on both paths (the
//     plan's SQL as service_role, standing for the service path's slug filters, and the
//     tenantDb read lib/team-profile/admin-data.ts runs), and the two agree by the comparison
//     the shadow mode uses;
//   - the plan, Auto-Assign and the two overrides, called through the area switch in tenant
//     mode exactly as the route and the page call them, keep to the caller's tenant: another
//     tenant's event reads as empty, and a write naming its event or participant changes
//     nothing;
//   - the same calls on the tenant's own event land.

import type { SupabaseClient } from '@supabase/supabase-js'
import type postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AssignError } from '@/lib/team-profile/assign'
import {
  autoAssignEvent,
  comparablePlan,
  loadTeamProfilePlan,
  overrideOutstandingEvent,
  overrideParticipant,
  readCompanyPlan,
  tenantCompanyPlan,
  tenantOverrideParticipant,
} from '@/lib/team-profile/admin-data'
import { CLEARED_OVERRIDE, overrideFields } from '@/lib/team-profile/override'
import { expectAreaIsolated, openTwoTenantKit, type KitTenant, type Seeded, type TwoTenantKit } from './kit'

let kit: TwoTenantKit
let seeded: Seeded

const actor = { userId: 'user_iso_admin', name: 'Iso Admin' }

beforeAll(async () => {
  kit = await openTwoTenantKit()
  seeded = await kit.seed('event_companies', 'registrations', 'participants')
  // One team profile per tenant's student, not yet submitted. The tenant is derived from the event.
  for (const t of [kit.stellr, kit.canary]) {
    await kit.admin`
      INSERT INTO public.team_profiles (participant_id, event_slug, token_hash, last_sent_at, send_count)
      VALUES (${seeded.participants[t.tag][0] as string}, ${t.event.slug}, ${`iso-a10c-${t.tag}`}, now(), 1)`
  }
})

afterAll(async () => {
  if (!kit) return
  await kit.admin`DELETE FROM public.team_profiles WHERE token_hash LIKE 'iso-a10c-%'`.catch(() => {})
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
  vi.stubEnv('TENANT_DB_AREAS', 'team-profiles:tenant')
}

const tenantOf = (id: string): KitTenant => (id === kit.stellr.id ? kit.stellr : kit.canary)

/** postgres.js's tagged template, in the shape readCompanyPlan takes. */
const asQuery = (sql: postgres.TransactionSql) => ({
  sql: <R>(strings: TemplateStringsArray, ...values: unknown[]) => sql(strings, ...(values as never[])) as unknown as Promise<R[]>,
})

const studentOf = (t: KitTenant) => seeded.participants[t.tag][0] as string
const companyOf = (t: KitTenant) => seeded.event_companies[t.tag][0] as string

const participantRow = async (id: string) => {
  const [row] = await kit.admin<{ company_id: string | null; company_locked: boolean; overridden_at: Date | null; by: string | null }[]>`
    SELECT company_id::text AS company_id, company_locked, team_profile_overridden_at AS overridden_at,
           team_profile_overridden_by AS by
    FROM public.participants WHERE id = ${id}`
  return row
}

describe('the team-profile plan', () => {
  it('returns only its own tenant’s students on both paths, and the paths agree', async () => {
    await expectAreaIsolated(kit, {
      service: async (sql, tenantId) => comparablePlan(await readCompanyPlan(asQuery(sql), tenantOf(tenantId).event.slug, null)).students,
      tenant: async (db) => comparablePlan(await tenantCompanyPlan(db, tenantOf(db.tenantId).event.slug, null)).students,
      key: (s) => s.participantId,
      expected: seeded.participants,
    })
  })

  it('through the area switch in tenant mode, the page’s own call keeps to the caller’s tenant', async () => {
    tenantMode()
    const own = await loadTeamProfilePlan(noService, kit.canary.id, kit.canary.event.slug, null)
    expect(own.companies.map((c) => c.id)).toEqual([companyOf(kit.canary)])
    expect(own.students.map((s) => [s.participantId, s.status])).toEqual([[studentOf(kit.canary), 'sent']])
    for (const [me, other] of [
      [kit.canary, kit.stellr],
      [kit.stellr, kit.canary],
    ] as const) {
      expect(await loadTeamProfilePlan(noService, me.id, other.event.slug, null)).toEqual({ companies: [], students: [] })
    }
  })
})

describe('the overrides, through the area switch in tenant mode', () => {
  it("override and override_all naming the other tenant's event or participant change nothing", async () => {
    tenantMode()
    const target = studentOf(kit.stellr)
    const before = await participantRow(target)
    const fields = overrideFields(actor)
    // As today's update: an id the caller cannot see matches nothing, and that is not an error.
    expect(await overrideParticipant(noService, kit.canary.id, kit.stellr.event.slug, target, fields)).toBe(true)
    expect(await overrideParticipant(noService, kit.canary.id, kit.canary.event.slug, target, fields)).toBe(true)
    expect(await tenantOverrideParticipant(kit.asTenant(kit.canary.id), kit.stellr.event.slug, target, fields)).toBe(0)
    expect(await overrideOutstandingEvent(noService, kit.canary.id, kit.stellr.event.slug, actor)).toEqual({ overridden: 0 })
    expect(await participantRow(target)).toEqual(before)
  })

  it("on the tenant's own event, override_all and override land and clear", async () => {
    tenantMode()
    for (const t of [kit.stellr, kit.canary]) {
      const pid = studentOf(t)
      expect(await overrideOutstandingEvent(noService, t.id, t.event.slug, actor)).toEqual({ overridden: 1 })
      expect(await participantRow(pid)).toMatchObject({ by: actor.userId })
      // Already overridden: the next run leaves it.
      expect(await overrideOutstandingEvent(noService, t.id, t.event.slug, actor)).toEqual({ overridden: 0 })
      expect(await overrideParticipant(noService, t.id, t.event.slug, pid, CLEARED_OVERRIDE)).toBe(true)
      expect(await participantRow(pid)).toMatchObject({ overridden_at: null, by: null })
      expect(await overrideParticipant(noService, t.id, t.event.slug, pid, overrideFields(actor))).toBe(true)
      expect((await participantRow(pid)).overridden_at).not.toBeNull()
      expect(await overrideParticipant(noService, t.id, t.event.slug, pid, CLEARED_OVERRIDE)).toBe(true)
    }
  })
})

describe('Auto-Assign, through the area switch in tenant mode', () => {
  beforeAll(async () => {
    await kit.admin`UPDATE public.team_profiles SET submitted_at = now() WHERE token_hash LIKE 'iso-a10c-%'`
  })

  it("naming the other tenant's event finds no companies, and changes nothing", async () => {
    tenantMode()
    const target = studentOf(kit.stellr)
    const before = await participantRow(target)
    await expect(autoAssignEvent(noService, kit.canary.id, kit.stellr.event.slug, null)).rejects.toBeInstanceOf(AssignError)
    expect(await participantRow(target)).toEqual(before)
  })

  it("on the tenant's own event, places its submitted student in its own company", async () => {
    tenantMode()
    for (const t of [kit.stellr, kit.canary]) {
      const pid = studentOf(t)
      expect(await autoAssignEvent(noService, t.id, t.event.slug, null)).toEqual({ assigned: 1, overridden: 0, pooled: 0, kept: 0 })
      expect(await participantRow(pid)).toMatchObject({ company_id: companyOf(t), company_locked: false })
      // The other tenant's student is where it was.
      const other = t === kit.stellr ? kit.canary : kit.stellr
      expect((await participantRow(studentOf(other))).company_id).not.toBe(companyOf(t))
    }
  })
})
