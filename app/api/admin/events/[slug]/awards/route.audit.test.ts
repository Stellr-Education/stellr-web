// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { sanitizeMetadata } from '@/lib/audit/platform'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { eventRouteFor, eventRouteRefused } from '@/test/fixtures/event-route'

// The event routes a Stellr Staff member or an event manager writes through
// requireEventAccess (Staff role P3/P4, GATE-AUDIT): judging, badge and certificate
// artwork, participation credentials and the check-in desk. Each records one platform
// audit event naming the caller requireEventAccess verified, on the chain of the event's
// owner (from the events mirror), with enums, ids and counts as metadata: never a
// student's name, a credential's wording, a check-in code or a link.
//
// S5 wave 8, C19a: the artwork and credentials routes check through lib/authz
// requireEventRoute and are Stellr-only for other tenants (decision W7-9), so on a tenant's
// event they refuse and record nothing. Their events below are on a Stellr event (h.owner),
// on Stellr's chain, the tenant requireEventRoute placed the event in.

const SLUG = 'tenant-event-2027'
const OWNER = '11111111-1111-4111-8111-111111111111'
/** The tenant the mirror gives any slug other than SLUG: where a row would wrongly land. */
const DECOY = '77777777-7777-4777-8777-777777777777'
const STUDENT = '22222222-2222-4222-8222-222222222222'
const TEMPLATE = '66666666-6666-4666-8666-666666666666'
const CALLER = 'user_managerplaceholder'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  access: { ok: true, userId: 'user_managerplaceholder', isAdmin: false, assignedSlugs: ['tenant-event-2027'] } as Record<string, unknown>,
  /** SLUG's owner in the events mirror. */
  owner: '11111111-1111-4111-8111-111111111111',
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
  getMirroredEvent: async (slug: string) => ({ slug, tenant_id: slug === 'tenant-event-2027' ? h.owner : '77777777-7777-4777-8777-777777777777' }),
}))
// requireEventRoute answers as requireEventAccess does here: the same caller, let in or refused,
// in Stellr's scope (the default AUTHZ_SOURCE and LOADSCOPED_MODE).
vi.mock('@/lib/authz', async (orig) => ({
  ...(await orig<typeof import('@/lib/authz')>()),
  requireEventRoute: async (slug: string) =>
    h.access.ok ? { ...eventRouteFor(slug), userId: h.access.userId, isAdmin: false } : eventRouteRefused(h.access.status as 401 | 403),
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_someoneelse' }) }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => h.access }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ title: 'Tenant Event', type: 'space', setting: 'in_person' }) }))
vi.mock('@/lib/campaigns', () => ({ themeFromType: () => 'space' }))
vi.mock('@/lib/event-award-issue', () => ({
  pendingAwardChanges: async () => 0,
  issueAwards: async () => ({ issued: 1, students: 1, reinstated: 0, revoked: 0, unchanged: 0, emailed: 1, skipped: 0, skips: [], failures: [] }),
}))
vi.mock('@/lib/event-certificates', () => ({
  attendees: <T,>(rows: T[]) => rows,
  fullName: (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`,
  listEventStudents: async () => [{ id: STUDENT, first_name: 'Sam', last_name: 'Student', company_id: null }],
  listEventCompanies: async () => [],
  listAssignments: async () => [],
  listEventMentors: async () => [],
  loadDefaultTemplates: async () => [],
  loadEventTemplate: async () => ({ event_slug: SLUG, award_type: 'participation', artwork_path: 'event-artwork/x.png' }),
  loadEventTemplates: async () => [],
}))
vi.mock('@/lib/artwork-defaults', () => ({ eventArtworkTheme: async () => 'space' }))
vi.mock('@/lib/artwork-template-input', async (orig) => ({
  ...(await orig<typeof import('@/lib/artwork-template-input')>()),
  claimArtwork: async () => null,
}))
vi.mock('@/lib/event-badges', () => ({
  fillPlacements: async (_db: unknown, t: unknown) => t,
  loadBadgeTemplate: async () => ({ id: TEMPLATE }),
  loadBadgeTemplates: async () => [],
  loadCompanies: async () => [],
  loadDefaultBadgeTemplates: async () => [],
  prepareTemplate: async () => null,
}))
vi.mock('@/lib/credentials', () => ({
  CREDENTIAL_COLUMNS: '*',
  eventTenantOnce: () => async () => OWNER,
  recordSkip: () => false,
  issueCredential: async () => ({ created: true, row: { id: 'cred-1' } }),
}))
vi.mock('@/lib/credentials-notify', () => ({ sendCredentialIssuedEmail: async () => true }))

const awards = await import('./route')
const issue = await import('./issue/route')
const badges = await import('../badge-templates/route')
const certificates = await import('../certificate-templates/route')
const credentials = await import('../credentials/route')
const desk = await import('../check-in/route')

const send = (method: string, path: string, body?: unknown) =>
  new Request(`https://app.test/api/admin/events/${SLUG}/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const ctx = { params: Promise.resolve({ slug: SLUG }) }
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const recorded = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))
const common = { tenantId: OWNER, actor: CALLER }
/** The C19a routes' events: a Stellr event, on Stellr's chain. */
const stellr = { tenantId: STELLR_TENANT_ID, actor: CALLER }
const stellrEvent = () => {
  h.owner = STELLR_TENANT_ID
  h.db.table('events')[0].tenant_id = STELLR_TENANT_ID
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.audits = []
  h.access = { ok: true, userId: CALLER, isAdmin: false, assignedSlugs: [SLUG] }
  h.owner = OWNER
  h.db = fakeSupabase({
    events: [{ slug: SLUG, tenant_id: OWNER }],
    event_badge_templates: [{ id: TEMPLATE, event_slug: SLUG, format: 'avery_5392', audience: 'everyone', company_id: null, artwork_path: 'event-artwork/b.png' }],
    event_certificate_templates: [{ event_slug: SLUG, award_type: 'participation', artwork_path: 'event-artwork/x.png' }],
    event_settings: [{ event_slug: SLUG, check_in_token: 'placeholder-token', check_in_open: false }],
    registrations: [
      {
        id: 'reg-1',
        event_slug: SLUG,
        status: 'confirmed',
        participants: [{ id: STUDENT, member_id: null, first_name: 'Sam', last_name: 'Student', email: 'sam@example.test', date_of_birth: '2010-01-01', event_role: 'participant', award: null, checked_in_at: '2027-01-01T10:00:00Z' }],
      },
    ],
    // The desk reads `registrations!inner(event_slug)` and filters on it by that name.
    participants: [{ id: STUDENT, 'registrations.event_slug': SLUG, checked_in_at: null }],
  })
})

describe('judging', () => {
  it('a change records which one, the award and the student id, never a name', async () => {
    const res = await awards.PUT(send('PUT', 'awards', { action: 'remove', awardType: 'norm_chaffee', participantId: STUDENT }), ctx)
    expect(res.status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      {
        ...common,
        action: 'event.awards.assign',
        target: { table: 'event_award_assignments', id: null },
        metadata: { event_slug: SLUG, award_action: 'remove', award_type: 'norm_chaffee', participant_id: STUDENT, status: 200 },
      },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Sam|Student/)
  })

  it('a caller requireEventAccess refuses records nothing', async () => {
    h.access = { ok: false, status: 403 }
    expect((await awards.PUT(send('PUT', 'awards', { action: 'remove', awardType: 'norm_chaffee', participantId: STUDENT }), ctx)).status).toBe(403)
    await flush()
    expect(h.audits).toEqual([])
  })
})

describe('badge and certificate artwork', () => {
  it('each save and delete records one event on the chain of the tenant the check placed the event in', async () => {
    stellrEvent()
    expect((await badges.PUT(send('PUT', 'badge-templates', { format: 'avery_5392', audience: 'everyone' }), ctx)).status).toBe(200)
    expect((await badges.DELETE(send('DELETE', `badge-templates?id=${TEMPLATE}`), ctx)).status).toBe(200)
    expect((await certificates.PUT(send('PUT', 'certificate-templates', { awardType: 'participation' }), ctx)).status).toBe(200)
    expect((await certificates.DELETE(send('DELETE', 'certificate-templates?awardType=participation'), ctx)).status).toBe(200)
    await flush()
    const badge = { table: 'event_badge_templates', id: TEMPLATE }
    const certificate = { table: 'event_certificate_templates', id: null }
    expect(recorded()).toEqual([
      { ...stellr, action: 'event.badge_template.save', target: badge, metadata: { event_slug: SLUG, format: 'avery_5392', audience: 'everyone', status: 200 } },
      { ...stellr, action: 'event.badge_template.delete', target: badge, metadata: { event_slug: SLUG, status: 200 } },
      { ...stellr, action: 'event.certificate_template.save', target: certificate, metadata: { event_slug: SLUG, award_type: 'participation', status: 200 } },
      { ...stellr, action: 'event.certificate_template.delete', target: certificate, metadata: { event_slug: SLUG, award_type: 'participation', status: 200 } },
    ])
  })

  it('on a tenant’s event each save and delete is refused, writes nothing and records nothing (C19a)', async () => {
    const before = JSON.stringify([h.db.table('event_badge_templates'), h.db.table('event_certificate_templates')])
    expect((await badges.PUT(send('PUT', 'badge-templates', { format: 'avery_5392', audience: 'everyone' }), ctx)).status).toBe(404)
    expect((await badges.DELETE(send('DELETE', `badge-templates?id=${TEMPLATE}`), ctx)).status).toBe(404)
    expect((await certificates.PUT(send('PUT', 'certificate-templates', { awardType: 'participation' }), ctx)).status).toBe(404)
    expect((await certificates.DELETE(send('DELETE', 'certificate-templates?awardType=participation'), ctx)).status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
    expect(JSON.stringify([h.db.table('event_badge_templates'), h.db.table('event_certificate_templates')])).toBe(before)
  })
})

describe('participation credentials', () => {
  it('the wording saved, and a run’s counts, never a name or the wording itself', async () => {
    stellrEvent()
    expect((await credentials.PATCH(send('PATCH', 'credentials', { credential_title: 'Free text title', audience: 'students' }), ctx)).status).toBe(200)
    const run = await credentials.POST(send('POST', 'credentials', { mode: 'checked_in' }), ctx)
    expect(run.status).toBe(200)
    expect(await run.json()).toMatchObject({ considered: 1, created: 1, emailed: 1 })
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'event.credentials.configure', target: { table: 'event_settings', id: null }, metadata: { event_slug: SLUG, audience: 'students', status: 200 } },
      {
        ...stellr,
        action: 'event.credentials.issue',
        target: { table: 'credentials', id: null },
        metadata: { event_slug: SLUG, audience: 'students', mode: 'checked_in', considered: 1, created: 1, existing: 0, notified: 1, skipped: 0, failed: 0, status: 200 },
      },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Free text|Sam|example\.test/)
  })

  it('on a tenant’s event the wording and a run are refused and record nothing (W7-9, C19a)', async () => {
    expect((await credentials.PATCH(send('PATCH', 'credentials', { credential_title: 'Free text title', audience: 'students' }), ctx)).status).toBe(404)
    expect((await credentials.POST(send('POST', 'credentials', { mode: 'checked_in' }), ctx)).status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
    expect(h.db.table('event_settings')[0]).not.toHaveProperty('credential_title')
  })
})

describe('the check-in desk', () => {
  it('a manual check-in names the participant and the tap', async () => {
    stellrEvent()
    expect((await desk.POST(send('POST', 'check-in', { action: 'manual', participantId: STUDENT }), ctx)).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'event.check_in.desk_action', target: { table: 'participants', id: STUDENT }, metadata: { event_slug: SLUG, desk_action: 'manual', status: 200 } },
    ])
  })

  it('regenerating the code records the tap and never the new token', async () => {
    stellrEvent()
    expect((await desk.POST(send('POST', 'check-in', { action: 'regenerate' }), ctx)).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'event.check_in.desk_action', target: { table: 'participants', id: null }, metadata: { event_slug: SLUG, desk_action: 'regenerate', status: 200 } },
    ])
    const token = h.db.table('event_settings')[0].check_in_token as string
    expect(JSON.stringify(h.audits)).not.toContain(token)
  })

  it('an unknown tap is refused and records nothing', async () => {
    stellrEvent()
    expect((await desk.POST(send('POST', 'check-in', { action: 'teleport' }), ctx)).status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })
  it('on a tenant’s event a desk tap is refused and records nothing (C19c)', async () => {
    expect((await desk.POST(send('POST', 'check-in', { action: 'manual', participantId: STUDENT }), ctx)).status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
  })
})

// audit() is mocked above, so the metadata it receives is unsanitised. The live write runs
// it through sanitizeMetadata, which drops any key naming (or containing a fragment of)
// personal data: 'emailed' contains 'email' and would be lost. Every key each event route
// records must survive the real sanitiser unchanged.
describe('every event route’s metadata survives the real sanitiser', () => {
  const survives = () => {
    expect(h.audits.length).toBeGreaterThan(0)
    for (const a of h.audits) {
      const metadata = a.metadata as Record<string, unknown>
      expect(sanitizeMetadata(metadata), String(a.action)).toEqual(metadata)
    }
  }

  it('the sanitiser drops a key containing email, which is why the runs record notified', () => {
    expect(sanitizeMetadata({ emailed: 1, notified: 1 })).toEqual({ notified: 1 })
  })

  it('judging: a change', async () => {
    expect((await awards.PUT(send('PUT', 'awards', { action: 'remove', awardType: 'norm_chaffee', participantId: STUDENT }), ctx)).status).toBe(200)
    await flush()
    survives()
  })

  it('judging: issuing the awards records the emailed count as notified', async () => {
    expect((await issue.POST(send('POST', 'awards/issue'), ctx)).status).toBe(200)
    await flush()
    survives()
    expect(h.audits[0].metadata).toEqual({ event_slug: SLUG, issued: 1, students: 1, reinstated: 0, revoked: 0, unchanged: 0, notified: 1, skipped: 0, failed: 0, status: 200 })
  })

  it('badge and certificate artwork: save and delete', async () => {
    stellrEvent()
    expect((await badges.PUT(send('PUT', 'badge-templates', { format: 'avery_5392', audience: 'everyone' }), ctx)).status).toBe(200)
    expect((await badges.DELETE(send('DELETE', `badge-templates?id=${TEMPLATE}`), ctx)).status).toBe(200)
    expect((await certificates.PUT(send('PUT', 'certificate-templates', { awardType: 'participation' }), ctx)).status).toBe(200)
    expect((await certificates.DELETE(send('DELETE', 'certificate-templates?awardType=participation'), ctx)).status).toBe(200)
    await flush()
    survives()
  })

  it('participation credentials: configure, and the students and mentors runs', async () => {
    stellrEvent()
    expect((await credentials.PATCH(send('PATCH', 'credentials', { credential_title: 'Free text title', audience: 'students' }), ctx)).status).toBe(200)
    expect((await credentials.POST(send('POST', 'credentials', { mode: 'checked_in' }), ctx)).status).toBe(200)
    expect((await credentials.POST(send('POST', 'credentials', { audience: 'mentors' }), ctx)).status).toBe(200)
    await flush()
    survives()
    const runs = h.audits.filter((a) => a.action === 'event.credentials.issue').map((a) => a.metadata as Record<string, unknown>)
    expect(runs.map((m) => [m.audience, 'notified' in m])).toEqual([['students', true], ['mentors', true]])
  })

  it('the check-in desk: a manual check-in and a regenerated code', async () => {
    stellrEvent()
    expect((await desk.POST(send('POST', 'check-in', { action: 'manual', participantId: STUDENT }), ctx)).status).toBe(200)
    expect((await desk.POST(send('POST', 'check-in', { action: 'regenerate' }), ctx)).status).toBe(200)
    await flush()
    survives()
  })
})

// The chain is the owner of the event requireEventAccess verified (the slug the handler
// passed it and noted), never the raw slug in the URL. Here the URL names the event in
// another case, or by an old slug, while the slug the check verified is SLUG: the mirror
// gives any slug but SLUG to DECOY, so a row built from the URL would land on DECOY's chain.
describe('the chain follows the slug requireEventAccess verified, not the URL', () => {
  const at = (urlSlug: string) => (method: string, path: string, body?: unknown) =>
    new Request(`https://app.test/api/admin/events/${urlSlug}/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const chains = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, event_slug: (a.metadata as Record<string, unknown>).event_slug }))
  const verified = (action: string) => ({ action, tenantId: OWNER, event_slug: SLUG })
  // C19a's routes, on a Stellr event: the tenant requireEventRoute placed it in.
  const placed = (action: string) => ({ action, tenantId: STELLR_TENANT_ID, event_slug: SLUG })

  for (const [label, urlSlug] of [
    ['a URL slug in another case', 'TENANT-EVENT-2027'],
    ['an old slug the check resolved', 'old-tenant-event'],
  ] as const) {
    describe(label, () => {
      const req = at(urlSlug)

      it('judging: a change', async () => {
        expect((await awards.PUT(req('PUT', 'awards', { action: 'remove', awardType: 'norm_chaffee', participantId: STUDENT }), ctx)).status).toBe(200)
        await flush()
        expect(chains()).toEqual([verified('event.awards.assign')])
      })

      it('judging: issuing the awards', async () => {
        expect((await issue.POST(req('POST', 'awards/issue'), ctx)).status).toBe(200)
        await flush()
        expect(chains()).toEqual([verified('event.awards.issue')])
      })

      it('badge artwork: save and delete', async () => {
        stellrEvent()
        expect((await badges.PUT(req('PUT', 'badge-templates', { format: 'avery_5392', audience: 'everyone' }), ctx)).status).toBe(200)
        expect((await badges.DELETE(req('DELETE', `badge-templates?id=${TEMPLATE}`), ctx)).status).toBe(200)
        await flush()
        expect(chains()).toEqual([placed('event.badge_template.save'), placed('event.badge_template.delete')])
      })

      it('certificate artwork: save and delete', async () => {
        stellrEvent()
        expect((await certificates.PUT(req('PUT', 'certificate-templates', { awardType: 'participation' }), ctx)).status).toBe(200)
        expect((await certificates.DELETE(req('DELETE', 'certificate-templates?awardType=participation'), ctx)).status).toBe(200)
        await flush()
        expect(chains()).toEqual([placed('event.certificate_template.save'), placed('event.certificate_template.delete')])
      })

      it('participation credentials: configure and issue', async () => {
        stellrEvent()
        expect((await credentials.PATCH(req('PATCH', 'credentials', { credential_title: 'Free text title', audience: 'students' }), ctx)).status).toBe(200)
        expect((await credentials.POST(req('POST', 'credentials', { mode: 'checked_in' }), ctx)).status).toBe(200)
        await flush()
        expect(chains()).toEqual([placed('event.credentials.configure'), placed('event.credentials.issue')])
      })
    })
  }
})
