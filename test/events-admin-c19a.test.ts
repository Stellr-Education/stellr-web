// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { eventRouteFor } from '@/test/fixtures/event-route'

// S5 wave 8, C19a: the credentials, badge and certificate artwork routes under
// app/api/admin/events/[slug] check through lib/authz requireEventRoute and ask the
// Stellr-only option (stellrOnlyEvent) first. A credential, a badge and a certificate say
// Stellr Education, and none is issued for another tenant's event until the tenant is the
// issuer (decision W7-9; SQ-16's default: credentials are a tenant feature later). So:
//   - another tenant's event is a 404 for a Stellr admin, after one read of the event's owner
//     and before anything else is read or written;
//   - a tenant's staff get a 503 before any read;
//   - a failed read of the event's owner is a retryable 503, never Stellr's;
//   - Stellr's own events, and a slug the mirror does not hold, go on as before.

const SLUG = 'colorado-space-design-challenge'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  route: null as unknown,
  /** The events mirror: slug to owner. A slug it lacks reads as Stellr's. */
  events: {} as Record<string, string>,
  eventsDown: false,
  tables: [] as string[],
  writes: [] as string[],
}))

function fakeDb() {
  return {
    storage: {
      from: () => ({ download: async () => ({ data: null, error: { message: 'none' } }) }),
    },
    from(table: string) {
      h.tables.push(table)
      let slug: unknown
      const done = { data: [] as unknown[], error: null, count: 0 }
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'neq', 'in', 'is', 'not', 'order', 'limit', 'or', 'match', 'filter']) chain[m] = () => chain
      for (const m of ['insert', 'update', 'upsert', 'delete']) {
        chain[m] = () => {
          h.writes.push(`${m} ${table}`)
          return chain
        }
      }
      chain.eq = (col: string, v: unknown) => {
        if (col === 'slug') slug = v
        return chain
      }
      chain.maybeSingle = async () => {
        if (table === 'events') {
          if (h.eventsDown) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
          const s = String(slug)
          return { data: s in h.events ? { tenant_id: h.events[s] } : null, error: null }
        }
        return { data: null, error: null }
      }
      chain.single = async () => ({ data: { id: 'row-1' }, error: null })
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(done).then(resolve, reject)
      return chain
    },
  }
}

vi.mock('@/lib/authz', () => ({ requireEventRoute: async () => h.route }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => null }))
vi.mock('@/lib/artwork-defaults', () => ({ eventArtworkTheme: async () => 'space' }))

const credentials = await import('@/app/api/admin/events/[slug]/credentials/route')
const badgeTemplates = await import('@/app/api/admin/events/[slug]/badge-templates/route')
const badgePreview = await import('@/app/api/admin/events/[slug]/badge-templates/preview/route')
const badges = await import('@/app/api/admin/events/[slug]/badges/route')
const certificateTemplates = await import('@/app/api/admin/events/[slug]/certificate-templates/route')
const certificatePreview = await import('@/app/api/admin/events/[slug]/certificate-templates/preview/route')
const certificates = await import('@/app/api/admin/events/[slug]/certificates/route')

const base = `https://app.stellreducation.org/api/admin/events/${SLUG}`
const req = (method: string, path: string, body?: unknown) =>
  new Request(`${base}/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const ctx = () => ({ params: Promise.resolve({ slug: SLUG }) })

type Handler = (r: Request, c: ReturnType<typeof ctx>) => Promise<Response>
const HANDLERS: Array<[string, Handler, () => Request]> = [
  ['credentials GET', credentials.GET as Handler, () => req('GET', 'credentials?audience=students')],
  ['credentials PATCH', credentials.PATCH as Handler, () => req('PATCH', 'credentials', { credential_title: 'A title', audience: 'students' })],
  ['credentials POST', credentials.POST as Handler, () => req('POST', 'credentials', { mode: 'all' })],
  ['badge-templates GET', badgeTemplates.GET as Handler, () => req('GET', 'badge-templates')],
  ['badge-templates PUT', badgeTemplates.PUT as Handler, () => req('PUT', 'badge-templates', { format: 'avery_5392', audience: 'everyone' })],
  ['badge-templates DELETE', badgeTemplates.DELETE as Handler, () => req('DELETE', 'badge-templates?id=row-1')],
  ['badge-templates/preview GET', badgePreview.GET as Handler, () => req('GET', 'badge-templates/preview?id=row-1')],
  ['badges GET', badges.GET as Handler, () => req('GET', 'badges?format=avery_5392')],
  ['certificate-templates GET', certificateTemplates.GET as Handler, () => req('GET', 'certificate-templates')],
  ['certificate-templates PUT', certificateTemplates.PUT as Handler, () => req('PUT', 'certificate-templates', { awardType: 'participation' })],
  ['certificate-templates DELETE', certificateTemplates.DELETE as Handler, () => req('DELETE', 'certificate-templates?awardType=participation')],
  ['certificate-templates/preview GET', certificatePreview.GET as Handler, () => req('GET', 'certificate-templates/preview?award=participation')],
  ['certificates GET', certificates.GET as Handler, () => req('GET', 'certificates?award=participation')],
]

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  h.route = eventRouteFor(SLUG)
  h.events = {}
  h.eventsDown = false
  h.tables = []
  h.writes = []
})

describe('C19a: credentials and artwork routes are Stellr-only for other tenants (W7-9)', () => {
  it.each(HANDLERS)('%s: another tenant’s event is a 404 for a Stellr admin, after the owner read alone', async (_name, handler, make) => {
    h.events = { [SLUG]: OTHER_TENANT }
    const res = await handler(make(), ctx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(h.tables).toEqual(['events'])
    expect(h.writes).toEqual([])
  })

  it.each(HANDLERS)('%s: a tenant’s staff get the 503 before any read', async (_name, handler, make) => {
    h.route = eventRouteFor(SLUG, OTHER_TENANT)
    h.events = { [SLUG]: OTHER_TENANT }
    const res = await handler(make(), ctx())
    expect(res.status).toBe(503)
    expect(h.tables).toEqual([])
    expect(h.writes).toEqual([])
  })

  it.each(HANDLERS)('%s: a failed read of the event’s owner is a retryable 503, never Stellr’s', async (_name, handler, make) => {
    h.eventsDown = true
    const res = await handler(make(), ctx())
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(h.tables).toEqual(['events'])
    expect(h.writes).toEqual([])
  })

  it.each(HANDLERS)('%s: Stellr’s own event goes on past the option', async (_name, handler, make) => {
    h.events = { [SLUG]: STELLR_TENANT_ID }
    const res = await handler(make(), ctx())
    expect([404, 503]).not.toContain(res.status)
    expect(h.tables[0]).toBe('events')
    expect(h.tables.filter((t) => t === 'events')).toHaveLength(1)
  })

  it('a slug the mirror does not hold is Stellr’s: the credentials list answers as before', async () => {
    const res = await credentials.GET(req('GET', 'credentials'), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      audience: 'students',
      settings: { credential_title: null, credential_description: null, credential_criteria: null, credential_skills: [] },
      credentials: [],
      checkedInCount: 0,
      mentorCount: 0,
    })
  })

  it('a refused caller gets requireEventRoute’s answer and nothing is read', async () => {
    const { eventRouteRefused } = await import('@/test/fixtures/event-route')
    h.route = eventRouteRefused(403)
    for (const [, handler, make] of HANDLERS) {
      const res = await handler(make(), ctx())
      expect(res.status).toBe(403)
    }
    expect(h.tables).toEqual([])
  })
})
