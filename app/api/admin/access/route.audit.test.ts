// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The access model's admin-only writes (GATE-AUDIT remainder, critique item 2): each
// records one platform audit event naming the signed-in admin, with the object (or the
// member) as the target and only ids, counts and enums in the metadata. A container goes
// on Stellr's chain; an event keyed by its slug on the chain the events mirror names, with
// the slug itself never stored. Down to the audit() call, with PLATFORM_AUDIT_ENABLED on.

const COHORT = '11111111-1111-4111-8111-111111111111'
const SPACE = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const MODULE = '44444444-4444-4444-8444-444444444444'
const OWNER = '55555555-5555-4555-8555-555555555555'
const CALLER = 'user_adminplaceholder'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  mirrored: [] as string[],
  grantOk: true,
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
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: CALLER, sessionClaims: { metadata: { role: 'admin' } } }) }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
// The roster removal filters member_roles with not('role', 'in', …), which the fake does
// not read, so member_roles answers every query with no error and no rows.
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const client = h.db.client as unknown as { from: (t: string) => unknown }
    return new Proxy(client, {
      get: (target, key) => {
        if (key !== 'from') return Reflect.get(target, key)
        return (table: string) => {
          if (table !== 'member_roles') return target.from(table)
          const chain: Record<string, unknown> = {}
          for (const m of ['delete', 'upsert', 'eq', 'not', 'select']) chain[m] = () => chain
          chain.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f)
          return chain
        }
      },
    })
  },
}))
vi.mock('@/lib/access-objects', async (orig) => ({
  ...(await orig<typeof import('@/lib/access-objects')>()),
  attachAllowed: async () => true,
  resolveAccessObject: async (ref: string) => {
    if (ref === COHORT) return { objectType: 'cohort', ref, label: 'Cohort', archived: false, containerId: COHORT }
    if (ref === SPACE) return { objectType: 'space', ref, label: 'Space', archived: false }
    if (ref === 'missing-0000') return null
    return { objectType: 'event', ref, label: ref, archived: false, slug: ref }
  },
}))
vi.mock('@/lib/object-roles', () => ({
  grantObjectRole: async () => (h.grantOk ? { ok: true } : { ok: false, error: 'boom' }),
  checkSingletonRoleAvailable: async () => ({ ok: true }),
}))
vi.mock('@/lib/object-created-rules', () => ({ fireObjectCreatedRules: async () => ({ applied: [], skipped: [] }) }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'm-admin' }) }))
vi.mock('@/lib/events/repo', () => ({ getAllEvents: async () => [], getAllCampaigns: async () => [] }))
vi.mock('@/lib/event-admin', () => ({ getEventRoster: async () => [] }))
vi.mock('@/lib/member-access', () => ({ getMemberAccessSummary: async () => ({ rows: [] }) }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin' }), logActivity: async () => {} }))
vi.mock('@/lib/member-roles', async (orig) => ({
  ...(await orig<typeof import('@/lib/member-roles')>()),
  addGlobalRole: async () => ({ ok: true }),
  roleAllowedForBracket: () => true,
}))

const { POST: createObject } = await import('./objects/route')
const contents = await import('./objects/[id]/contents/route')
const managers = await import('./objects/[id]/managers/route')
const roster = await import('./objects/[id]/roster/route')
const people = await import('./people/[id]/route')
const { PATCH: setRelation } = await import('./relations/route')

const send = (method: string, path: string, body?: unknown) =>
  new Request(`https://app.test/api/admin/access${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const recorded = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))
const stellr = { tenantId: STELLR_TENANT_ID, actor: CALLER }

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.audits = []
  h.mirrored = []
  h.grantOk = true
  h.db = fakeSupabase({
    members: [{ id: MEMBER, age_bracket: 'adult' }],
    community_spaces: [],
    community_channels: [],
    mentoring_cohorts: [],
    container_contents: [],
    community_space_sources: [],
    object_roles: [],
    member_roles: [],
    cohort_members: [],
    community_space_members: [],
    object_type_relations: [],
  })
})

describe('access: objects', () => {
  it('a new Space is the target; the name typed in is never stored', async () => {
    const res = await createObject(send('POST', '/objects', { objectType: 'space', name: 'Study Hall Placeholder' }))
    expect(res.status).toBe(200)
    const { ref } = await res.json()
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'access.object.create', target: { table: 'community_spaces', id: ref }, metadata: { object_type: 'space', status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Study Hall/)
  })

  it('a missing name is a refusal and records nothing', async () => {
    expect((await createObject(send('POST', '/objects', { objectType: 'space' }))).status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })
})

describe('access: contents, managers and roster on a container', () => {
  it('each write names the cohort row, and what was attached, granted or added', async () => {
    const id = ctx(COHORT)
    expect((await contents.POST(send('POST', `/objects/${COHORT}/contents`, { ref: MODULE, contentType: 'training_module' }), id)).status).toBe(200)
    expect((await contents.DELETE(send('DELETE', `/objects/${COHORT}/contents`, { ref: MODULE, contentType: 'training_module' }), id)).status).toBe(200)
    expect((await managers.POST(send('POST', `/objects/${COHORT}/managers`, { memberId: MEMBER }), id)).status).toBe(200)
    expect((await managers.DELETE(send('DELETE', `/objects/${COHORT}/managers`, { memberId: MEMBER }), id)).status).toBe(200)
    expect((await roster.POST(send('POST', `/objects/${COHORT}/roster`, { memberId: MEMBER, role: 'mentor' }), id)).status).toBe(200)
    expect((await roster.DELETE(send('DELETE', `/objects/${COHORT}/roster`, { memberId: MEMBER }), id)).status).toBe(200)
    await flush()
    const target = { table: 'mentoring_cohorts', id: COHORT }
    const content = { object_type: 'cohort', content_type: 'training_module', content_ref: MODULE, status: 200 }
    expect(recorded()).toEqual([
      { ...stellr, action: 'access.object_content.attach', target, metadata: content },
      { ...stellr, action: 'access.object_content.detach', target, metadata: content },
      { ...stellr, action: 'access.object_manager.grant', target, metadata: { object_type: 'cohort', member_id: MEMBER, status: 200 } },
      { ...stellr, action: 'access.object_manager.revoke', target, metadata: { object_type: 'cohort', member_id: MEMBER, status: 200 } },
      { ...stellr, action: 'access.object_roster.add', target, metadata: { object_type: 'cohort', member_id: MEMBER, role: 'mentor', status: 200 } },
      { ...stellr, action: 'access.object_roster.remove', target, metadata: { object_type: 'cohort', member_id: MEMBER, status: 200 } },
    ])
    expect(h.mirrored).toEqual([])
  })

  it('a role that is not one of ours never reaches the metadata', async () => {
    await roster.POST(send('POST', `/objects/${COHORT}/roster`, { memberId: MEMBER, role: 'Placeholder Person' }), ctx(COHORT))
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0].metadata).not.toHaveProperty('role')
    expect(JSON.stringify(h.audits)).not.toMatch(/Placeholder Person/)
  })

  it('a failed grant is a 500 and is recorded with its status', async () => {
    h.grantOk = false
    expect((await managers.POST(send('POST', `/objects/${COHORT}/managers`, { memberId: MEMBER }), ctx(COHORT))).status).toBe(500)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'access.object_manager.grant', target: { table: 'mentoring_cohorts', id: COHORT }, metadata: { object_type: 'cohort', member_id: MEMBER, status: 500 } },
    ])
  })

  it('an object that does not resolve is a 404 and records nothing', async () => {
    expect((await managers.POST(send('POST', '/objects/missing-0000/managers', { memberId: MEMBER }), ctx('missing-0000'))).status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
  })
})

describe('access: an event keyed by its slug', () => {
  it("goes on the chain the mirror names; the URL's slug is never stored", async () => {
    const slug = 'placeholder-event-2026'
    expect((await managers.POST(send('POST', `/objects/${slug}/managers`, { memberId: MEMBER }), ctx(slug))).status).toBe(200)
    await flush()
    expect(h.mirrored).toEqual([slug])
    expect(recorded()).toEqual([
      { tenantId: OWNER, actor: CALLER, action: 'access.object_manager.grant', target: { table: 'events', id: null }, metadata: { object_type: 'event', member_id: MEMBER, status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toContain(slug)
  })
})

describe('access: people and the relationship matrix', () => {
  it('a global role chip names the member and the role; the matrix cell names its types', async () => {
    const id = ctx(MEMBER)
    expect((await people.POST(send('POST', `/people/${MEMBER}`, { role: 'mentor' }), id)).status).toBe(200)
    expect((await people.DELETE(send('DELETE', `/people/${MEMBER}`, { role: 'mentor' }), id)).status).toBe(200)
    expect((await setRelation(send('PATCH', '/relations', { fromType: 'space', toType: 'course', allowed: true }))).status).toBe(200)
    await flush()
    const target = { table: 'members', id: MEMBER }
    expect(recorded()).toEqual([
      { ...stellr, action: 'access.member_role.grant', target, metadata: { role: 'mentor', status: 200 } },
      { ...stellr, action: 'access.member_role.revoke', target, metadata: { role: 'mentor', status: 200 } },
      { ...stellr, action: 'access.relation.set', target: { table: 'object_type_relations', id: null }, metadata: { from_type: 'space', to_type: 'course', allowed: true, status: 200 } },
    ])
  })

  it('removing the base role is refused and records nothing', async () => {
    expect((await people.DELETE(send('DELETE', `/people/${MEMBER}`, { role: 'member' }), ctx(MEMBER))).status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })

  it('with the flag off, nothing is scheduled or written', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    expect((await setRelation(send('PATCH', '/relations', { fromType: 'space', toType: 'course', allowed: false }))).status).toBe(200)
    await flush()
    expect(h.afters).toEqual([])
    expect(h.audits).toEqual([])
  })
})
