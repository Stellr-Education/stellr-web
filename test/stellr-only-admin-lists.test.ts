// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 tracker s5-programme.29: the Stellr-only admin list APIs read Stellr's rows only
// (stellrRows: tenant_id = Stellr, or NULL for a row the backfill has not reached), and
// never another tenant's. Today every row is Stellr's or NULL, so Stellr's lists are what
// they were. The fake answers the `or` filter as PostgREST would, so each test seeds one
// row of each kind and checks which come back, alongside the filters each list already had.

const OTHER = '00000000-0000-4000-8000-0000000000aa'

let db: FakeDb
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.client }))
vi.mock('@/lib/authz', () => ({ isStellrAdmin: async () => true, hasCapability: async () => true }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_admin_placeholder' }) }))
vi.mock('@/lib/events/repo', () => ({ getAllEvents: async () => [], getAllCampaigns: async () => [] }))
vi.mock('@/lib/container-sync', () => ({}))
vi.mock('@/lib/sessions', () => ({}))
vi.mock('@/lib/object-created-rules', () => ({}))
vi.mock('@/lib/resource-upload', () => ({}))
vi.mock('@/lib/resource-finalise', () => ({}))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'resources', getSignedInMember: async () => null }))

/** Three rows of a table: Stellr's, one with no tenant yet, and another tenant's. */
function three<T extends Record<string, unknown>>(make: (id: string) => T) {
  return [
    { ...make('stellr'), tenant_id: STELLR_TENANT_ID },
    { ...make('unstamped'), tenant_id: null },
    { ...make('other'), tenant_id: OTHER },
  ]
}

const ids = (rows: Array<{ id?: string; ref?: string }>) => rows.map((r) => r.id ?? r.ref).sort()

beforeEach(() => {
  db = fakeSupabase({})
})

describe("Stellr-only admin list APIs keep to Stellr's rows", () => {
  it('community spaces', async () => {
    db = fakeSupabase({ community_spaces: three((id) => ({ id, name: id, display_order: 1 })) })
    const { GET } = await import('@/app/api/admin/community/spaces/route')
    const { spaces } = await (await GET()).json()
    expect(ids(spaces)).toEqual(['stellr', 'unstamped'])
  })

  it('community resources', async () => {
    db = fakeSupabase({ community_resources: three((id) => ({ id, title: id, created_at: '2026-11-01' })) })
    const { GET } = await import('@/app/api/admin/community/resources/route')
    const { resources } = await (await GET()).json()
    expect(ids(resources)).toEqual(['stellr', 'unstamped'])
  })

  it('resource search keeps its stored-file and title filters', async () => {
    db = fakeSupabase({
      community_resources: [
        ...three((id) => ({ id, title: `Rocket ${id}`, storage_path: `p/${id}`, created_at: '2026-11-01' })),
        { id: 'stellr-link', title: 'Rocket link', storage_path: null, created_at: '2026-11-01', tenant_id: STELLR_TENANT_ID },
        { id: 'stellr-other-title', title: 'Orbit', storage_path: 'p/o', created_at: '2026-11-01', tenant_id: STELLR_TENANT_ID },
      ],
    })
    const { GET } = await import('@/app/api/admin/community/resources/search/route')
    const { results } = await (await GET(new Request('http://localhost/api/admin/community/resources/search?q=rocket'))).json()
    expect(ids(results)).toEqual(['stellr', 'unstamped'])
  })

  it('training modules', async () => {
    db = fakeSupabase({ training_modules: three((id) => ({ id, title: id, display_order: 1 })) })
    const { GET } = await import('@/app/api/admin/community/training/modules/route')
    const { modules } = await (await GET()).json()
    expect(ids(modules)).toEqual(['stellr', 'unstamped'])
  })

  it('Staff settings module choices', async () => {
    db = fakeSupabase({
      staff_role_settings: [{ id: true, training_module_id: null }],
      training_modules: three((id) => ({ id, title: id })),
    })
    const { GET } = await import('@/app/api/admin/staff-settings/route')
    const { modules } = await (await GET()).json()
    expect(ids(modules)).toEqual(['stellr', 'unstamped'])
  })

  it('coaching workshops keep their type and lifecycle filters', async () => {
    db = fakeSupabase({
      mentoring_cohorts: [
        ...three((id) => ({ id, name: id, container_type: 'coaching', lifecycle: 'active', created_at: '2026-11-01' })),
        { id: 'stellr-mentoring', name: 'm', container_type: 'mentoring', lifecycle: 'active', created_at: '2026-11-01', tenant_id: STELLR_TENANT_ID },
      ],
    })
    const { GET } = await import('@/app/api/admin/coaching/route')
    const { workshops } = await (await GET()).json()
    expect(ids(workshops)).toEqual(['stellr', 'unstamped'])
  })

  it('space source picker, training and mentoring', async () => {
    db = fakeSupabase({
      training_modules: three((id) => ({ id, title: id })),
      mentoring_cohorts: three((id) => ({ id, name: id, container_type: 'mentoring' })),
    })
    const { GET } = await import('@/app/api/admin/community/spaces/sources/search/route')
    const url = (type: string) => new Request(`http://localhost/api/admin/community/spaces/sources/search?type=${type}`)
    expect(ids((await (await GET(url('training'))).json()).options)).toEqual(['stellr', 'unstamped'])
    expect(ids((await (await GET(url('mentoring'))).json()).options)).toEqual(['stellr', 'unstamped'])
  })

  it('access editor object picker, all four tables', async () => {
    db = fakeSupabase({
      mentoring_cohorts: three((id) => ({ id: `cohort-${id}`, name: id, container_type: 'mentoring', lifecycle: 'active', campaign_ref: null })),
      community_spaces: three((id) => ({ id: `space-${id}`, name: id, slug: `s-${id}`, is_archived: false })),
      training_modules: three((id) => ({ id: `module-${id}`, title: id })),
      community_resources: three((id) => ({ id: `resource-${id}`, title: id })),
    })
    const { GET } = await import('@/app/api/admin/access/objects/route')
    const body = await (await GET()).json()
    const refs = ids(body.objects as Array<{ ref: string }>)
    expect(refs).toEqual(
      ['cohort', 'module', 'resource', 'space'].flatMap((t) => [`${t}-stellr`, `${t}-unstamped`]).sort(),
    )
  })
})
