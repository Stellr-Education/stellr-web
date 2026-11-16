// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// deep review AUTH-10: the Sanity → Supabase event-sync webhook must accept its
// shared secret ONLY via the x-webhook-secret header, never the ?secret= query
// string (which leaks into access logs). The constant-time compare and _id
// requirement are unchanged; this pins that the query form no longer authorises.

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/event-space-sync', () => ({
  syncEventSpace: async (_db: unknown, by: unknown) => {
    space.sync(by)
    return { containerId: 'c1', spaceId: 's1', created: true, renamedFrom: null, notes: [] }
  },
}))
vi.mock('@/lib/object-created-rules', () => ({ fireObjectCreatedRules: async () => ({}) }))
vi.mock('@/lib/survey/distributions', () => ({ ensureDistribution: async () => ({ action: 'scheduled' }) }))
vi.mock('@/lib/survey/events', () => ({ loadSurveyEvent: async () => null }))
// Real constant-time compare — the behaviour under test is which transport is read.
vi.mock('@/lib/secret-compare', () => ({ safeStrEqual: (a: string, b: string) => a === b }))
const hubspot = vi.hoisted(() => ({
  isProd: false,
  sync: vi.fn(async () => ({
    ok: true,
    applied: true,
    liveEvents: [],
    unmapped: [],
    properties: [{ object: 'contacts', property: 'event', status: 'updated' }],
    form: { status: 'unchanged' },
  })),
}))
vi.mock('@/lib/env-guards', () => ({ isRealProductionApp: () => hubspot.isProd }))
vi.mock('@/lib/hubspot-event-options', () => ({ syncEventOptions: hubspot.sync }))
// S3 events mirror: the route calls syncEventMirrorSafe last; it must never be
// able to fail the webhook.
const mirror = vi.hoisted(() => ({ sync: vi.fn(async (_db: unknown, _by: unknown) => ({ status: 'synced' as string })) }))
// deep review v2 .12: the route re-reads the event from Sanity by _id and syncs
// that copy, not the payload's fields.
const sanity = vi.hoisted(() => ({
  fetch: vi.fn(async (_by: { sanityId?: string }): Promise<Record<string, unknown> | null> => ({
    _id: 'doc1', _updatedAt: '2026-11-14T10:00:00Z', title: 'CO SDC', slug: 'co-sdc', activityType: 'event',
  })),
}))
vi.mock('@/lib/events/sync', () => ({ syncEventMirrorSafe: mirror.sync, fetchSanityEvent: sanity.fetch }))
const space = vi.hoisted(() => ({ sync: vi.fn() }))

const SECRET = 'placeholder-webhook-secret'
const { POST } = await import('./route')

function body() {
  return JSON.stringify({ _id: 'doc1', _type: 'event', slug: { current: 'co-sdc' }, title: 'CO SDC' })
}

beforeEach(() => { process.env.SANITY_WEBHOOK_SECRET = SECRET })
afterEach(() => { delete process.env.SANITY_WEBHOOK_SECRET })

describe('POST /api/admin/sanity/event-sync — secret transport (AUTH-10)', () => {
  it('rejects the secret supplied only in the ?secret= query string', async () => {
    const res = await POST(new Request(`https://app.test/api/admin/sanity/event-sync?secret=${SECRET}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body(),
    }))
    expect(res.status).toBe(403)
  })

  it('accepts the secret supplied in the x-webhook-secret header', async () => {
    const res = await POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: body(),
    }))
    expect(res.status).toBe(200)
  })

  it('rejects a missing secret', async () => {
    const res = await POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body(),
    }))
    expect(res.status).toBe(403)
  })
})

// One HubSpot portal, no sandbox: only the real production app may change the
// CRM's option lists, whichever deployment Sanity's webhook happens to reach.
describe('POST /api/admin/sanity/event-sync — HubSpot option sync', () => {
  function publish() {
    return POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: body(),
    }))
  }

  afterEach(() => { hubspot.isProd = false; hubspot.sync.mockClear() })

  it('skips the sync off the production app', async () => {
    const res = await publish()
    const json = await res.json()
    expect(hubspot.sync).not.toHaveBeenCalled()
    expect(json.hubspotOptions).toMatch(/skipped/)
  })

  it('applies the sync on the production app and reports what changed', async () => {
    hubspot.isProd = true
    const res = await publish()
    const json = await res.json()
    expect(hubspot.sync).toHaveBeenCalledWith({ apply: true, stellrOnlyDb: expect.anything() })
    expect(json.hubspotOptions).toMatchObject({ ok: true, updated: ['contacts.event'] })
  })

  it('does not fail the webhook when the sync throws', async () => {
    hubspot.isProd = true
    hubspot.sync.mockRejectedValueOnce(new Error('HubSpot down'))
    const res = await publish()
    expect(res.status).toBe(200)
    expect((await res.json()).hubspotOptions).toBe('error')
  })
})

describe('POST /api/admin/sanity/event-sync — events mirror (S3)', () => {
  function publish() {
    return POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: body(),
    }))
  }

  afterEach(() => { mirror.sync.mockClear() })

  it('mirrors the published event by its Sanity _id and reports the outcome', async () => {
    const res = await publish()
    expect(res.status).toBe(200)
    expect(mirror.sync).toHaveBeenCalledWith(expect.anything(), { sanityId: 'doc1', slug: 'co-sdc' })
    expect((await res.json()).mirror).toBe('synced')
  })

  it('still answers 200 with the rest of the sync when the mirror reports an error', async () => {
    mirror.sync.mockResolvedValueOnce({ status: 'error' })
    const res = await publish()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, slug: 'co-sdc', mirror: 'error', containerId: 'c1' })
  })

  it('does not fail the webhook even if the mirror throws', async () => {
    mirror.sync.mockRejectedValueOnce(new Error('mirror down'))
    const res = await publish()
    expect(res.status).toBe(200)
    expect((await res.json()).mirror).toBe('error')
  })

  it('is not called for a refused request', async () => {
    const res = await POST(new Request('https://app.test/api/admin/sanity/event-sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: body(),
    }))
    expect(res.status).toBe(403)
    expect(mirror.sync).not.toHaveBeenCalled()
  })
})

// deep review v2 .12: Sanity's signed delivery. The signature is built here the
// way Sanity builds it (@sanity/webhook): HMAC-SHA256 over "<t>.<body>", base64url.
function sign(payload: string, secret = SECRET, t = Date.now()) {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('base64url')
  return `t=${t},v1=${v1}`
}

function post(headers: Record<string, string>, payload = body()) {
  return POST(new Request('https://app.test/api/admin/sanity/event-sync', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: payload,
  }))
}

describe('POST /api/admin/sanity/event-sync — signed delivery and re-fetch (deep review v2 .12)', () => {
  let info: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks(); sanity.fetch.mockClear(); space.sync.mockClear() })

  const logged = () => (info.mock.calls as unknown[][]).map((c) => String(c[0])).join('\n')

  it('accepts a valid Sanity signature with no header, and logs the signature path without the secret', async () => {
    const payload = body()
    const res = await post({ 'sanity-webhook-signature': sign(payload) }, payload)
    expect(res.status).toBe(200)
    expect((await res.json()).auth).toBe('signature')
    expect(logged()).toContain('authorised by signature')
    expect(logged()).not.toContain(SECRET)
  })

  it('accepts the x-webhook-secret header with no signature, and logs the header path', async () => {
    const res = await post({ 'x-webhook-secret': SECRET })
    expect(res.status).toBe(200)
    expect((await res.json()).auth).toBe('header')
    expect(logged()).toContain('authorised by x-webhook-secret header')
    expect(logged()).not.toContain(SECRET)
  })

  it('refuses a request with neither (403, as before)', async () => {
    const res = await post({})
    expect(res.status).toBe(403)
    expect(sanity.fetch).not.toHaveBeenCalled()
  })

  it('refuses a signature made with the wrong secret (401)', async () => {
    const payload = body()
    const res = await post({ 'sanity-webhook-signature': sign(payload, 'placeholder-wrong-secret') }, payload)
    expect(res.status).toBe(401)
    expect(sanity.fetch).not.toHaveBeenCalled()
    expect(space.sync).not.toHaveBeenCalled()
  })

  it('refuses a valid signature over a different body (tampered payload)', async () => {
    const res = await post({ 'sanity-webhook-signature': sign(body()) }, JSON.stringify({ _id: 'other', _type: 'event' }))
    expect(res.status).toBe(401)
  })

  it('refuses a malformed signature header', async () => {
    const res = await post({ 'sanity-webhook-signature': 'not-a-signature' })
    expect(res.status).toBe(401)
  })

  it('refuses everything when SANITY_WEBHOOK_SECRET is unset, signed or not', async () => {
    delete process.env.SANITY_WEBHOOK_SECRET
    const payload = body()
    expect((await post({ 'sanity-webhook-signature': sign(payload) }, payload)).status).toBe(403)
    expect((await post({ 'x-webhook-secret': SECRET })).status).toBe(403)
  })

  it('re-fetches the event by _id and syncs Sanity\'s copy, not the payload\'s fields', async () => {
    const payload = JSON.stringify({ _id: 'doc1', _type: 'event', slug: { current: 'forged-slug' }, title: 'Forged', activityType: 'campaign' })
    const res = await post({ 'sanity-webhook-signature': sign(payload) }, payload)
    expect(res.status).toBe(200)
    expect(sanity.fetch).toHaveBeenCalledWith({ sanityId: 'doc1' })
    expect(space.sync).toHaveBeenCalledWith({ sanityId: 'doc1', slug: 'co-sdc', title: 'CO SDC' })
    expect(mirror.sync).toHaveBeenCalledWith(expect.anything(), { sanityId: 'doc1', slug: 'co-sdc' })
    expect((await res.json()).slug).toBe('co-sdc')
  })

  it('answers 503 when the re-fetch throws, so Sanity retries, and syncs nothing', async () => {
    sanity.fetch.mockRejectedValueOnce(new Error('Sanity down'))
    const res = await post({ 'x-webhook-secret': SECRET })
    expect(res.status).toBe(503)
    expect(space.sync).not.toHaveBeenCalled()
  })

  it('answers 503 when the document is not readable yet', async () => {
    sanity.fetch.mockResolvedValueOnce(null)
    const res = await post({ 'x-webhook-secret': SECRET })
    expect(res.status).toBe(503)
    expect(space.sync).not.toHaveBeenCalled()
  })

  it('answers 503 when Sanity returns an older revision than the payload names', async () => {
    const payload = JSON.stringify({ _id: 'doc1', _type: 'event', _updatedAt: '2026-11-14T11:00:00Z' })
    const res = await post({ 'sanity-webhook-signature': sign(payload) }, payload)
    expect(res.status).toBe(503)
    expect(space.sync).not.toHaveBeenCalled()
  })

  it('refuses a draft _id without fetching (a retry could never succeed)', async () => {
    const res = await post({ 'x-webhook-secret': SECRET }, JSON.stringify({ _id: 'drafts.doc1', _type: 'event' }))
    expect(res.status).toBe(400)
    expect(sanity.fetch).not.toHaveBeenCalled()
  })

  it('still requires an _id', async () => {
    const res = await post({ 'x-webhook-secret': SECRET }, JSON.stringify({ _type: 'event', slug: 'co-sdc' }))
    expect(res.status).toBe(400)
  })
})
