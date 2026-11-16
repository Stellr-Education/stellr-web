// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The rest of the admin-only writes (GATE-AUDIT remainder, critique item 2): a member's
// record (PATCH and DELETE), the adjudication of a flagged background check, the
// background-check re-poll, the on-demand digest and Sanity's event-sync webhook. Each
// records one platform audit event, down to the audit() call, with PLATFORM_AUDIT_ENABLED
// on. The end of view-as is covered in ../../impersonation/route.test.ts.

const MEMBER = '33333333-3333-4333-8333-333333333333'
const CHECK = '44444444-4444-4444-8444-444444444444'
const OWNER = '55555555-5555-4555-8555-555555555555'
const CONTAINER = '66666666-6666-4666-8666-666666666666'
const SPACE = '77777777-7777-4777-8777-777777777777'
const CALLER = 'user_adminplaceholder'
const SECRET = 'placeholder-webhook-secret'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  mirrored: [] as string[],
  sanitySlug: 'placeholder-event-2026',
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    h.afters.push(task)
  },
}))
vi.mock('@/lib/audit/platform', async (orig) => ({
  ...(await orig<typeof import('@/lib/audit/platform')>()),
  audit: async (input: Record<string, unknown>) => {
    h.audits.push(input)
    return { ok: true, id: h.audits.length, chainSeq: h.audits.length }
  },
}))
vi.mock('@/lib/events/mirror', () => ({
  getMirroredEvent: async (slug: string) => {
    h.mirrored.push(slug)
    return { slug, tenant_id: OWNER }
  },
}))
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: CALLER, sessionClaims: {} }),
  currentUser: async () => ({ primaryEmailAddress: { emailAddress: 'admin@example.test' } }),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true, currentUserIsAdmin: async () => true }))
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin', actorLabel: 'Admin' }), logActivity: async () => {} }))
vi.mock('@/lib/esign/retention', () => ({ startRetentionClock: async () => {} }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/event-manager', () => ({ recheckEventManagerClearance: async () => {} }))
vi.mock('@/lib/background-provider', () => ({ getBackgroundProvider: () => ({ name: 'checkr', configured: () => true }) }))
vi.mock('@/lib/background-sync', () => ({ syncStaleChecks: async () => ({ scanned: 4, updated: 1, unchanged: 3, errors: [] }) }))
vi.mock('@/lib/admin-digest', () => ({ loadMemberDigest: async () => ({}) }))
vi.mock('@/lib/admin-digest-email', () => ({ renderDigestEmail: () => ({ subject: 'Digest', html: '<p/>', text: '' }) }))
vi.mock('@/lib/email-campaigns', () => ({ appUrl: () => 'https://app.test' }))
vi.mock('@/lib/email', () => ({ sendEmail: async () => {} }))
vi.mock('@/lib/event-space-sync', () => ({
  syncEventSpace: async () => ({ spaceId: SPACE, containerId: CONTAINER, created: true, renamedFrom: null, notes: [], skippedOtherTenant: false }),
}))
vi.mock('@/lib/object-created-rules', () => ({ fireObjectCreatedRules: async () => ({ applied: [], skipped: [] }) }))
vi.mock('@/lib/survey/distributions', () => ({ ensureDistribution: async () => ({ action: 'scheduled' }) }))
vi.mock('@/lib/survey/events', () => ({ loadSurveyEvent: async () => null }))
vi.mock('@/lib/env-guards', () => ({ isRealProductionApp: () => false }))
vi.mock('@/lib/hubspot-event-options', () => ({ syncEventOptions: async () => ({}) }))
vi.mock('@/lib/events/sync', () => ({
  fetchSanityEvent: async () => ({ _id: 'evt-doc', title: 'Placeholder Event', slug: { current: h.sanitySlug } }),
  syncEventMirrorSafe: async () => ({ status: 'synced' }),
}))

const member = await import('./route')
const { POST: adjudicate } = await import('./background-check/adjudicate/route')
const { POST: syncChecks } = await import('../../compliance/sync/route')
const { POST: sendDigest } = await import('../../digest/send/route')
const { POST: eventSync } = await import('../../sanity/event-sync/route')

const send = (method: string, path: string, body?: unknown) =>
  new Request(`https://app.test/api/admin${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const id = { params: Promise.resolve({ id: MEMBER }) }
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const recorded = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))
const stellr = { tenantId: STELLR_TENANT_ID, actor: CALLER }

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  vi.stubEnv('SANITY_WEBHOOK_SECRET', SECRET)
  h.afters = []
  h.audits = []
  h.mirrored = []
  h.db = fakeSupabase({
    members: [{ id: MEMBER, first_name: 'Pat', last_name: 'Placeholder', email: 'pat@example.test', graduation_year: null, is_active: true }],
    member_ethnicities: [],
    member_allergies: [],
    member_background_checks: [{ id: CHECK, member_id: MEMBER, status: 'referred', completed_at: null, ordered_at: '2026-01-01' }],
  })
})

describe('members/[id]: the record', () => {
  it('an update names the fields that changed, never their values; a deactivation names the member', async () => {
    expect((await member.PATCH(send('PATCH', `/members/${MEMBER}`, { first_name: 'Renamed', email: 'pat@example.test', graduation_year: '2020' }), id)).status).toBe(200)
    expect((await member.DELETE(send('DELETE', `/members/${MEMBER}`), id)).status).toBe(200)
    await flush()
    const target = { table: 'members', id: MEMBER }
    expect(recorded()).toEqual([
      { ...stellr, action: 'member.record.update', target, metadata: { fields: ['first_name', 'graduation_year'], status: 200 } },
      { ...stellr, action: 'member.record.deactivate', target, metadata: { status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Renamed|example\.test|2020/)
  })

  it('a graduation year out of range is a 400 and records nothing', async () => {
    expect((await member.PATCH(send('PATCH', `/members/${MEMBER}`, { graduation_year: '1900' }), id)).status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })

  it('a failed save is recorded with its status', async () => {
    h.db = fakeSupabase({ members: [] }, { failOn: (t, a) => (t === 'members' && a === 'update' ? 'boom' : null) })
    expect((await member.DELETE(send('DELETE', `/members/${MEMBER}`), id)).status).toBe(500)
    await flush()
    expect(recorded()).toEqual([{ ...stellr, action: 'member.record.deactivate', target: { table: 'members', id: MEMBER }, metadata: { status: 500 } }])
  })
})

describe('compliance: adjudication and re-poll', () => {
  it('the decision names the member, the check and the outcome; never the rationale', async () => {
    const res = await adjudicate(send('POST', `/members/${MEMBER}/background-check/adjudicate`, { outcome: 'cleared', notes: 'Placeholder rationale text', checkId: CHECK }), id)
    expect(res.status).toBe(200)
    expect((await syncChecks(send('POST', '/compliance/sync'))).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'compliance.background_check.adjudicate', target: { table: 'members', id: MEMBER }, metadata: { check_id: CHECK, outcome: 'cleared', status: 200 } },
      { ...stellr, action: 'compliance.background_check.sync', target: { table: 'member_background_checks', id: null }, metadata: { scanned: 4, updated: 1, unchanged: 3, errors: 0, status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('rationale')
  })

  it('clearing without a rationale is refused and records nothing', async () => {
    expect((await adjudicate(send('POST', `/members/${MEMBER}/background-check/adjudicate`, { outcome: 'cleared' }), id)).status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })
})

describe('digest: the on-demand send', () => {
  it('names who asked; the address it went to is never stored', async () => {
    expect((await sendDigest()).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([{ ...stellr, action: 'digest.preview.send', target: null, metadata: { status: 200 } }])
    expect(JSON.stringify(h.audits)).not.toContain('example.test')
  })
})

describe("sanity: event-sync, Sanity's webhook", () => {
  const hook = (payload: unknown) =>
    new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: JSON.stringify(payload),
    })

  it("goes on the owner's chain by the slug re-read from Sanity, never the payload's", async () => {
    const res = await eventSync(hook({ _id: 'evt-doc', _type: 'event', slug: { current: 'payload-slug-ignored' } }))
    expect(res.status).toBe(200)
    await flush()
    expect(h.mirrored).toEqual(['placeholder-event-2026'])
    expect(recorded()).toEqual([
      {
        tenantId: OWNER,
        actor: 'webhook:sanity',
        action: 'event.access.sync',
        target: { table: 'mentoring_cohorts', id: CONTAINER },
        metadata: { event_slug: 'placeholder-event-2026', object_type: 'event', space_id: SPACE, created: true, other_tenant: false, status: 200 },
      },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('payload-slug-ignored')
  })

  it('a wrong secret is refused and records nothing', async () => {
    const res = await eventSync(new Request('https://app.test/api/admin/sanity/event-sync', { method: 'POST', headers: { 'x-webhook-secret': 'nope' }, body: '{}' }))
    expect(res.status).toBe(403)
    await flush()
    expect(h.audits).toEqual([])
  })
})
