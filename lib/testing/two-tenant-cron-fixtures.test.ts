// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CRON_SCOPES } from '@/lib/cron-scope'
import { CRON_FIXTURE_DEFINITION, cronFixtureIds, PER_TENANT_CRONS, planCronFixtures, type FixtureTenant } from './two-tenant-cron-fixtures'

// The plan behind the two-tenant cron fixtures (S5 B26). The I/O runs in CI's
// tenant-db job (test/integration/two-tenant/crons.int.test.ts); this checks
// the plan itself.

const tenants: Record<'stellr' | 'canary', FixtureTenant> = {
  stellr: { id: 's', event: { slug: 'iso-a-event' }, spare: { slug: 'iso-a-event-2' } },
  canary: { id: 'c', event: { slug: 'iso-b-event' }, spare: { slug: 'iso-b-event-2' } },
}
const NOW = new Date('2026-11-15T12:00:00Z')
const plan = planCronFixtures(tenants, NOW)

describe('planCronFixtures', () => {
  it('covers exactly the per-tenant crons lib/cron-scope.ts names', () => {
    const perTenant = Object.entries(CRON_SCOPES).filter(([, e]) => e.scope === 'per_tenant').map(([job]) => job).sort()
    expect([...PER_TENANT_CRONS].sort()).toEqual(perTenant)
  })

  it('gives every per-tenant cron rows for both tenants', () => {
    for (const cron of PER_TENANT_CRONS) {
      for (const tag of ['stellr', 'canary'] as const) {
        expect(plan.some((r) => r.tag === tag && r.crons.includes(cron)), `${cron} / ${tag}`).toBe(true)
      }
    }
  })

  it("hangs each tenant's rows off that tenant's own events, and never sets tenant_id", () => {
    for (const r of plan) {
      expect(r.values).not.toHaveProperty('tenant_id')
      if (!r.tag || !('event_slug' in r.values)) continue
      const own = [tenants[r.tag].event.slug, tenants[r.tag].spare.slug]
      expect(own, `${r.table} ${r.values.id}`).toContain(r.values.event_slug)
    }
  })

  it('uses distinct fixed ids per tenant, parents before children', () => {
    const ids = plan.map((r) => String(r.values.id))
    expect(new Set(ids).size).toBe(ids.length)
    const s = cronFixtureIds('stellr')
    const c = cronFixtureIds('canary')
    expect(Object.values(s).some((id) => Object.values(c).includes(id))).toBe(false)
    const at = (table: string, id: string) => plan.findIndex((r) => r.table === table && r.values.id === id)
    for (const ids of [s, c]) {
      expect(at('registrations', ids.registration)).toBeLessThan(at('participants', ids.participant))
      expect(at('survey_distributions', ids.distributionOld)).toBeLessThan(at('survey_invitations', ids.invitationOld))
      expect(at('participants', ids.participant)).toBeLessThan(at('survey_invitations', ids.invitationOld))
    }
    expect(plan[0].values.id).toBe(CRON_FIXTURE_DEFINITION)
  })

  it('sets the times each cron needs relative to now', () => {
    const reg = plan.find((r) => r.table === 'registrations' && r.tag === 'canary')!
    expect(Date.parse(String(reg.values.invoice_sync_due_at))).toBeLessThan(NOW.getTime())
    const env = plan.find((r) => r.table === 'agreements' && r.tag === 'stellr')!
    expect(NOW.getTime() - Date.parse(String(env.values.sent_at))).toBeGreaterThan(7 * 86_400_000)
    const open = plan.find((r) => r.table === 'survey_distributions' && r.values.status === 'open' && r.tag === 'stellr')!
    expect(Date.parse(String(open.values.opens_at))).toBeLessThan(NOW.getTime())
    expect(Date.parse(String(open.values.closes_at))).toBeGreaterThan(NOW.getTime())
  })

  it('holds no personal data: example.test addresses only', () => {
    const emails = plan.flatMap((r) => Object.values(r.values)).filter((v): v is string => typeof v === 'string' && v.includes('@'))
    expect(emails.length).toBeGreaterThan(0)
    for (const e of emails) expect(e).toMatch(/@example\.test$/)
  })
})
