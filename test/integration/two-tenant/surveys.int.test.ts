// The 'surveys' area on a real database (multi-tenancy plan S5, A10c). Run by CI's tenant-db
// job only (vitest.integration.config.mts), on the two-tenant kit. Proves, through the real
// driver and the tenant row level security policies:
//
//   - the distribution read and the completion read return only their own tenant's rows on
//     both paths (the service path's filter, as service_role, and the tenantDb read
//     lib/survey/admin-data.ts runs), and the two paths agree by the comparison the shadow
//     mode uses (the completion read without its members embed, which tenant_app cannot read);
//   - the reads, called through the area switch in tenant mode exactly as the survey tab calls
//     them, keep to the caller's tenant: another tenant's event and distribution read as empty;
//   - a write naming another tenant's distribution changes nothing, an access-log row naming
//     another tenant's event is refused and lands nothing, and the same writes on the tenant's
//     own rows land, stamped with that tenant.

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  loadCompletionInvitations,
  loadDistributionForEvent,
  logSurveyView,
  setDistributionGateCertificate,
  surveyAdminDb,
  tenantCompletionInvitations,
  tenantDistributionForEvent,
  tenantLogSurveyView,
  withoutMembers,
  type CompletionInvitation,
} from '@/lib/survey/admin-data'
import type { DistributionRow } from '@/lib/survey/distributions'
import { FIXTURES, TENANTS } from '../../../scripts/gen-tenant-isolation-pgtap.mjs'
import { expectAreaIsolated, openTwoTenantKit, type KitTenant, type Seeded, type TwoTenantKit } from './kit'

let kit: TwoTenantKit
let seeded: Seeded

/** The matrix's survey definition id, read from its own fixture so the two cannot drift. */
const DEFINITION = (
  (FIXTURES as Record<string, (c: unknown) => Record<string, string>>)['public.survey_distributions']({
    tag: 'a',
    t: TENANTS.a,
    ev: TENANTS.a.primary,
    s: 'x',
    seed: false,
  }).definition_id as string
).replace(/'/g, '')

beforeAll(async () => {
  kit = await openTwoTenantKit()
  // A platform row the kit does not write: the distributions' definition, keyed as the
  // service path's filter expects.
  await kit.admin`
    INSERT INTO public.survey_definitions (id, key, version, title, definition, definition_sha256)
    VALUES (${DEFINITION}, 'post_event', 9001, 'Iso survey', '{}'::jsonb, repeat('0', 64))
    ON CONFLICT (id) DO NOTHING`
  seeded = await kit.seed('survey_distributions', 'survey_invitations', 'survey_access_log')
})

afterAll(async () => {
  if (!kit) return
  // The definition outlives the kit's cleanup, so its distributions (and, by cascade, their
  // invitations) go first, then the definition, then everything else the kit wrote.
  await kit.admin`DELETE FROM public.survey_distributions WHERE definition_id = ${DEFINITION}`.catch(() => {})
  await kit.admin`DELETE FROM public.survey_definitions WHERE id = ${DEFINITION}`.catch(() => {})
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
  vi.stubEnv('TENANT_DB_AREAS', 'surveys:tenant')
}

const tenantOf = (id: string): KitTenant => (id === kit.stellr.id ? kit.stellr : kit.canary)
const distributionOf = (t: KitTenant): string => seeded.survey_distributions[t.tag][0] as string

type Sql = Parameters<Parameters<TwoTenantKit['service']>[0]>[0]

/** The service path's filter as service_role: distributionForEvent's, rendered as PostgREST renders the row. */
const serviceDistribution = async (sql: Sql, slug: string) =>
  (
    await sql<{ row: DistributionRow }[]>`
      SELECT to_jsonb(d) AS row
      FROM public.survey_distributions d
      JOIN public.survey_definitions s ON s.id = d.definition_id
      WHERE d.event_slug = ${slug} AND s.key = 'post_event'
      ORDER BY d.created_at DESC LIMIT 1`
  ).map((r) => r.row)

/** The service path's filter as service_role: the completion select, members embed included. */
const serviceCompletion = async (sql: Sql, distributionId: string) =>
  (
    await sql<{ row: CompletionInvitation }[]>`
      SELECT jsonb_build_object(
        'id', i.id, 'member_id', i.member_id, 'first_name', i.first_name,
        'respondent_role', i.respondent_role, 'adult_relationship', i.adult_relationship,
        'email', i.email, 'send_via', i.send_via, 'status', i.status, 'sent_at', i.sent_at,
        'first_opened_at', i.first_opened_at, 'opened_from', i.opened_from,
        'last_activity_at', i.last_activity_at, 'reminder_count', i.reminder_count,
        'resume_reminder_count', i.resume_reminder_count,
        'reminders_opted_out_at', i.reminders_opted_out_at, 'last_send_error', i.last_send_error,
        'participants', (SELECT jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'member_id', p.member_id)
                           FROM public.participants p WHERE p.id = i.participant_id),
        'members', (SELECT jsonb_build_object('first_name', m.first_name, 'last_name', m.last_name)
                      FROM public.members m WHERE m.id = i.member_id),
        'survey_responses', (SELECT jsonb_build_object('started_at', r.started_at, 'submitted_at', r.submitted_at)
                               FROM public.survey_responses r WHERE r.invitation_id = i.id)
      ) AS row
      FROM public.survey_invitations i WHERE i.distribution_id = ${distributionId}::uuid`
  ).map((r) => r.row)

const distributionAsOwner = async (id: string) => {
  const [row] = await kit.admin<{ status: string; gate_certificate: boolean; tenant_id: string }[]>`
    SELECT status, gate_certificate, tenant_id::text AS tenant_id FROM public.survey_distributions WHERE id = ${id}::uuid`
  return row
}

const accessRows = async (slug: string) =>
  kit.admin<{ actor: string; tenant_id: string }[]>`
    SELECT actor, tenant_id::text AS tenant_id FROM public.survey_access_log WHERE event_slug = ${slug} ORDER BY at`

describe('the reads', () => {
  it('the distribution: only its own tenant’s row on both paths, and the paths agree', async () => {
    await expectAreaIsolated<DistributionRow>(kit, {
      service: (sql, tenantId) => serviceDistribution(sql, tenantOf(tenantId).event.slug),
      tenant: async (db) => {
        const d = await tenantDistributionForEvent(db, tenantOf(db.tenantId).event.slug)
        return d ? [d] : []
      },
      expected: seeded.survey_distributions,
    })
  })

  it('the completion table: only its own tenant’s invitations on both paths, and the paths agree without the members embed', async () => {
    await expectAreaIsolated<CompletionInvitation>(kit, {
      service: (sql, tenantId) => serviceCompletion(sql, distributionOf(tenantOf(tenantId))),
      tenant: (db) => tenantCompletionInvitations(db, distributionOf(tenantOf(db.tenantId))),
      normalise: withoutMembers,
      expected: seeded.survey_invitations,
    })
  })

  it("tenantDb finds nothing of the other tenant's, in both directions", async () => {
    for (const [me, other] of [
      [kit.stellr, kit.canary],
      [kit.canary, kit.stellr],
    ] as const) {
      expect(await tenantDistributionForEvent(kit.asTenant(me.id), other.event.slug)).toBeNull()
      expect(await tenantCompletionInvitations(kit.asTenant(me.id), distributionOf(other))).toEqual([])
      expect((await tenantDistributionForEvent(kit.asTenant(me.id), me.event.slug))?.id).toBe(distributionOf(me))
    }
  })

  it('through the area switch in tenant mode, the survey tab’s own calls keep to the caller’s tenant', async () => {
    tenantMode()
    expect((await loadDistributionForEvent(noService, kit.canary.id, kit.canary.event.slug))?.id).toBe(distributionOf(kit.canary))
    expect(await loadDistributionForEvent(noService, kit.canary.id, kit.stellr.event.slug)).toBeNull()
    expect(await loadDistributionForEvent(noService, kit.stellr.id, kit.canary.event.slug)).toBeNull()
    expect((await loadCompletionInvitations(noService, kit.canary.id, distributionOf(kit.canary))).map((r) => r.id)).toEqual(
      seeded.survey_invitations.canary,
    )
    expect(await loadCompletionInvitations(noService, kit.canary.id, distributionOf(kit.stellr))).toEqual([])
  })
})

describe('the writes, through the area switch in tenant mode', () => {
  it("a status change naming the other tenant's distribution changes nothing", async () => {
    tenantMode()
    const target = distributionOf(kit.stellr)
    const before = await distributionAsOwner(target)
    const r = await surveyAdminDb(noService, kit.canary.id).updateDistribution(target, { status: 'closed', closed_by: 'x' }, ['scheduled', 'open', 'paused'])
    expect(r).toEqual({ data: [], error: null })
    expect(await distributionAsOwner(target)).toEqual(before)
  })

  it("the certificate gate naming the other tenant's distribution changes nothing, and the service write never runs", async () => {
    tenantMode()
    const target = distributionOf(kit.canary)
    const before = await distributionAsOwner(target)
    const service = vi.fn(async () => undefined)
    await setDistributionGateCertificate(service, kit.stellr.id, target, !before.gate_certificate)
    expect(service).not.toHaveBeenCalled()
    expect(await distributionAsOwner(target)).toEqual(before)
  })

  it("an access-log row naming the other tenant's event is refused, and nothing lands", async () => {
    const before = await accessRows(kit.stellr.event.slug)
    await expect(
      tenantLogSurveyView(kit.asTenant(kit.canary.id), { actor: 'iso-cross', eventSlug: kit.stellr.event.slug, distributionId: null, rowCount: 1 }),
    ).rejects.toThrow()
    tenantMode()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await logSurveyView(noService, kit.canary.id, { actor: 'iso-cross', eventSlug: kit.stellr.event.slug, distributionId: distributionOf(kit.stellr), rowCount: 1 })
    error.mockRestore()
    expect(await accessRows(kit.stellr.event.slug)).toEqual(before)
  })

  it('on the tenant’s own rows the same calls land, stamped with that tenant', async () => {
    tenantMode()
    for (const t of [kit.stellr, kit.canary]) {
      const id = distributionOf(t)
      const paused = await surveyAdminDb(noService, t.id).updateDistribution(id, { status: 'paused', paused_at: '2026-11-08T00:00:00.000Z' }, ['scheduled'])
      expect(paused.error).toBeNull()
      expect(paused.data?.map((d) => [d.id, d.status, d.tenant_id])).toEqual([[id, 'paused', t.id]])
      const resumed = await surveyAdminDb(noService, t.id).updateDistribution(id, { status: 'scheduled', paused_at: null }, ['paused'])
      expect(resumed.data?.map((d) => d.status)).toEqual(['scheduled'])

      const before = await distributionAsOwner(id)
      await setDistributionGateCertificate(async () => undefined, t.id, id, !before.gate_certificate)
      expect(await distributionAsOwner(id)).toEqual({ ...before, gate_certificate: !before.gate_certificate })

      await logSurveyView(noService, t.id, { actor: `iso-own-${t.tag}`, eventSlug: t.event.slug, distributionId: id, rowCount: 1 })
      expect((await accessRows(t.event.slug)).filter((r) => r.actor === `iso-own-${t.tag}`)).toEqual([{ actor: `iso-own-${t.tag}`, tenant_id: t.id }])
      // The detail lands as an object, not a JSON string (the parameter is bound as text).
      const [detail] = await kit.admin<{ kind: string; what: string | null }[]>`
        SELECT jsonb_typeof(detail) AS kind, detail ->> 'what' AS what FROM public.survey_access_log WHERE actor = ${`iso-own-${t.tag}`}`
      expect(detail).toEqual({ kind: 'object', what: 'completion_table' })
    }
  })
})
