// S6-USE on a real database, the gate: usage figures equal SQL counts. Run by CI's
// tenant-db job only (vitest.integration.config.mts), on the two-tenant kit.
//
// Writes usage_events for both kit tenants on yesterday and today (UTC), with rows
// on each edge of the window and one older than the 90-day raw window, then runs
// the cron's own runUsageRollup (lib/usage/rollup.ts) through the kit's
// service_role client: the real usage_rollup() function and the real purge. Proves:
//
//   - usage_daily per tenant, day and kind equals the count taken straight from
//     usage_events and members with SQL, for both tenants;
//   - a second run writes the same totals (idempotent);
//   - the purge removes only rows older than 90 days, and a rolled-up day keeps
//     its totals after its raw rows are gone.

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rollupDays, runUsageRollup } from '@/lib/usage/rollup'
import { openTwoTenantKit, type TwoTenantKit } from './kit'
import { AccessLog, restClient } from './rest'

let kit: TwoTenantKit
let db: SupabaseClient
const inserted: string[] = []
const now = new Date()
const [yesterday, today] = rollupDays(now)
const fail = (where: string, err: unknown) => {
  throw new Error(`${where}: ${String(err)}`)
}

type Total = { tenant_id: string; day: string; kind: string; total: string }

/** The SQL counts, independent of usage_rollup(): raw events per tenant and kind, plus new members as the owner's identities. */
async function sqlCounts(day: string): Promise<Total[]> {
  return kit.admin<Total[]>`
    SELECT tenant_id::text, ${day}::text AS day, kind, sum(n)::text AS total FROM (
      SELECT e.tenant_id, e.kind, e.count::bigint AS n FROM public.usage_events e
       WHERE e.occurred_at >= (${day}::date)::timestamp AT TIME ZONE 'UTC'
         AND e.occurred_at <  (${day}::date + 1)::timestamp AT TIME ZONE 'UTC'
      UNION ALL
      SELECT ${STELLR_TENANT_ID}::uuid, 'identity', 1 FROM public.members m
       WHERE m.created_at >= (${day}::date)::timestamp AT TIME ZONE 'UTC'
         AND m.created_at <  (${day}::date + 1)::timestamp AT TIME ZONE 'UTC'
    ) s GROUP BY tenant_id, kind ORDER BY tenant_id, kind`
}

async function rolledUp(day: string): Promise<Total[]> {
  return kit.admin<Total[]>`
    SELECT tenant_id::text, day::text, kind, total::text FROM public.usage_daily
     WHERE day = ${day}::date ORDER BY tenant_id, kind`
}

beforeAll(async () => {
  kit = await openTwoTenantKit()
  db = restClient((fn) => kit.service(fn), new AccessLog()) as SupabaseClient
  const rows: [string, string, string, number][] = []
  for (const t of [kit.stellr, kit.canary]) {
    rows.push(
      [t.id, 'registration', `${yesterday}T00:00:00Z`, 1],
      [t.id, 'registration', `${yesterday}T23:59:59.999Z`, 1],
      [t.id, 'email', `${yesterday}T12:00:00Z`, t.tag === 'stellr' ? 5 : 2],
      [t.id, 'event', `${today}T00:00:00Z`, 1],
      // Older than the raw window: the purge takes it.
      [t.id, 'email', new Date(now.getTime() - 91 * 86_400_000).toISOString(), 1],
    )
  }
  for (const [tenant, kind, at, count] of rows) {
    const [r] = await kit.admin<{ id: string }[]>`
      INSERT INTO public.usage_events (tenant_id, kind, occurred_at, count)
      VALUES (${tenant}, ${kind}, ${at}, ${count}) RETURNING id::text AS id`
    inserted.push(r.id)
  }
})

afterAll(async () => {
  if (!kit) return
  if (inserted.length) await kit.admin`DELETE FROM public.usage_events WHERE id = ANY(${inserted}::bigint[])`
  await kit.admin`DELETE FROM public.usage_daily WHERE day IN (${yesterday}::date, ${today}::date)`
  await kit.cleanup()
})

describe('usage roll-up on a real database (S6-USE)', () => {
  it('usage_daily equals the SQL counts per tenant, day and kind, for both tenants', async () => {
    const result = await runUsageRollup(db, { now, fail })
    expect(result.failures).toBe(0)
    for (const day of [yesterday, today]) {
      const want = await sqlCounts(day)
      expect(await rolledUp(day), day).toEqual(want)
      expect(result.days.find((d) => d.day === day)?.rows).toBe(want.length)
    }
    const y = await rolledUp(yesterday)
    const pick = (tenant: string, kind: string) => y.find((r) => r.tenant_id === tenant && r.kind === kind)?.total
    expect(pick(kit.stellr.id, 'registration')).toBe('2')
    expect(pick(kit.canary.id, 'registration')).toBe('2')
    expect(pick(kit.stellr.id, 'email')).toBe('5')
    expect(pick(kit.canary.id, 'email')).toBe('2')
  })

  it('purged only the rows past the raw window', async () => {
    const [{ old }] = await kit.admin<{ old: number }[]>`
      SELECT count(*)::int AS old FROM public.usage_events WHERE id = ANY(${inserted}::bigint[]) AND occurred_at < now() - interval '90 days'`
    expect(old).toBe(0)
    const [{ kept }] = await kit.admin<{ kept: number }[]>`
      SELECT count(*)::int AS kept FROM public.usage_events WHERE id = ANY(${inserted}::bigint[])`
    expect(kept).toBe(8)
  })

  it('a second run writes the same totals', async () => {
    const before = [await rolledUp(yesterday), await rolledUp(today)]
    const again = await runUsageRollup(db, { now, fail })
    expect(again.failures).toBe(0)
    expect(again.purged).toBe(0)
    expect([await rolledUp(yesterday), await rolledUp(today)]).toEqual(before)
  })

  it('keeps a day\'s totals once its raw rows are gone', async () => {
    const before = await rolledUp(yesterday)
    await kit.admin`DELETE FROM public.usage_events WHERE id = ANY(${inserted}::bigint[]) AND occurred_at < ${today}::date`
    expect(await rolledUp(yesterday)).toEqual(before)
  })
})
