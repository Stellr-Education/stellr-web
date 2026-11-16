import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// hubspotFetch is the one transport behind lib/hubspot, hubspot-deals and
// hubspot-companies. This pins the request it builds; the -deals and
// -companies suites pin the URLs their callers pass through it.
describe('hubspotFetch', () => {
  const OLD = process.env.HUBSPOT_ACCESS_TOKEN
  beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = 'test-token'
    vi.resetModules()
  })
  afterEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = OLD
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('posts JSON to api.hubapi.com with the bearer token', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    await hubspotFetch('/crm/v3/objects/deals', 'POST', { properties: { dealname: 'x' } })
    expect(fetchMock).toHaveBeenCalledWith('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { dealname: 'x' } }),
    })
  })

  it('sends no body on GET', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    await hubspotFetch('/crm/v3/objects/companies/1', 'GET')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(init).not.toHaveProperty('body')
  })

  // deep review INT-7: a rate-limited READ is retried with backoff instead of
  // being surfaced as a hard failure (which dealsForContact then read as "no
  // deals" → a duplicate deal). Writes are never auto-retried.
  const res429 = () => ({ ok: false, status: 429, headers: { get: () => null } }) as unknown as Response

  it('retries a rate-limited GET with backoff, then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const p = hubspotFetch('/crm/v4/objects/contacts/1/associations/deals', 'GET')
    await vi.runAllTimersAsync()
    const res = await p
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries the batch-read POST (a read) on 429', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const p = hubspotFetch('/crm/v3/objects/deals/batch/read', 'POST', { inputs: [] })
    await vi.runAllTimersAsync()
    await p
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a rate-limited write (a deal-create POST)', async () => {
    const fetchMock = vi.fn(async () => res429())
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const res = await hubspotFetch('/crm/v3/objects/deals', 'POST', { properties: {} })
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after 3 attempts on a sustained 429', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => res429())
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const p = hubspotFetch('/crm/v3/objects/contacts/1', 'GET')
    await vi.runAllTimersAsync()
    const res = await p
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

// deploy-env.hubspot-dry-run: HUBSPOT_DRY_RUN=1 skips every write at this one
// transport, so dev can hold a token (to exercise the reads) without writing to
// the one live portal. Unset, nothing changes.
describe('hubspotFetch — HUBSPOT_DRY_RUN', () => {
  const OLD_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
  const OLD_DRY = process.env.HUBSPOT_DRY_RUN
  const ok200 = () => new Response(JSON.stringify({ id: 'real' }), { status: 200 })

  beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = 'test-token'
    vi.resetModules()
  })
  afterEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = OLD_TOKEN
    if (OLD_DRY === undefined) delete process.env.HUBSPOT_DRY_RUN
    else process.env.HUBSPOT_DRY_RUN = OLD_DRY
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('on (HUBSPOT_DRY_RUN=1)', () => {
    beforeEach(() => {
      process.env.HUBSPOT_DRY_RUN = '1'
    })

    it.each([
      ['POST', '/crm/v3/objects/deals'],
      ['POST', '/crm/v3/objects/notes'],
      ['PATCH', '/crm/v3/objects/deals/77'],
      ['PUT', '/crm/v4/objects/contacts/1/associations/default/companies/2'],
      ['DELETE', '/crm/v3/objects/contacts/1'],
      ['PATCH', '/crm/v3/properties/contacts/event'],
      ['PATCH', '/marketing/v3/forms/form-guid'],
    ] as const)('does not fetch a %s write to %s, and returns a success', async (method, path) => {
      const fetchMock = vi.fn(async () => ok200())
      vi.stubGlobal('fetch', fetchMock)
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { hubspotFetch, HUBSPOT_DRY_RUN_ID } = await import('./hubspot')

      const res = await hubspotFetch(path, method, { properties: {} })

      expect(fetchMock).not.toHaveBeenCalled()
      expect(res.ok).toBe(true)
      expect(await res.json()).toEqual({ id: HUBSPOT_DRY_RUN_ID })
      expect(log).toHaveBeenCalledWith(`[hubspot] dry-run ${method} ${path}`)
    })

    it('logs no personal data: the email segment and the query string are dropped', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ok200()))
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { hubspotFetch } = await import('./hubspot')

      await hubspotFetch(
        `/crm/v3/objects/contacts/${encodeURIComponent('someone@example.com')}?idProperty=email`,
        'PATCH',
        { properties: { firstname: 'Placeholder' } },
      )

      expect(log).toHaveBeenCalledTimes(1)
      const line = String(log.mock.calls[0][0])
      expect(line).toBe('[hubspot] dry-run PATCH /crm/v3/objects/contacts/<email>')
      expect(line).not.toMatch(/example\.com|%40|@|Placeholder|idProperty/)
    })

    it('still runs reads: a GET, a search POST and a batch-read POST all fetch', async () => {
      const fetchMock = vi.fn(async () => ok200())
      vi.stubGlobal('fetch', fetchMock)
      const { hubspotFetch } = await import('./hubspot')

      await hubspotFetch('/crm/v3/objects/contacts/1', 'GET')
      await hubspotFetch('/crm/v3/objects/contacts/search', 'POST', { filterGroups: [] })
      await hubspotFetch('/crm/v3/objects/deals/batch/read', 'POST', { inputs: [] })

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
        'https://api.hubapi.com/crm/v3/objects/contacts/1',
        'https://api.hubapi.com/crm/v3/objects/contacts/search',
        'https://api.hubapi.com/crm/v3/objects/deals/batch/read',
      ])
    })

    it('accepts "true" as well as "1"', async () => {
      process.env.HUBSPOT_DRY_RUN = 'true'
      const fetchMock = vi.fn(async () => ok200())
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const { hubspotFetch } = await import('./hubspot')
      await hubspotFetch('/crm/v3/objects/deals', 'POST', {})
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('off', () => {
    it.each([undefined, '', '0', 'false'])('HUBSPOT_DRY_RUN=%s writes as before', async (value) => {
      if (value === undefined) delete process.env.HUBSPOT_DRY_RUN
      else process.env.HUBSPOT_DRY_RUN = value
      const fetchMock = vi.fn(async () => ok200())
      vi.stubGlobal('fetch', fetchMock)
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const { hubspotFetch } = await import('./hubspot')

      const res = await hubspotFetch('/crm/v3/objects/deals', 'POST', { properties: { dealname: 'x' } })

      expect(fetchMock).toHaveBeenCalledWith('https://api.hubapi.com/crm/v3/objects/deals', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { dealname: 'x' } }),
      })
      expect(await res.json()).toEqual({ id: 'real' })
      expect(log).not.toHaveBeenCalled()
    })
  })
})
