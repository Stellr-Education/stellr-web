import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// deploy-env.hubspot-dry-run, end to end through captureLead: with
// HUBSPOT_DRY_RUN=1 the form submission (another host, not hubspotFetch), the
// contact write, the lifecycle stamp and the note are all skipped; the read
// still runs; nothing is dead-lettered; the capture reports success.

const { insert, sendEmail } = vi.hoisted(() => ({
  insert: vi.fn(async () => ({ error: null })),
  sendEmail: vi.fn(async () => {}),
}))
vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: () => ({ insert }) }) }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))

const EMAIL = 'new-lead@example.com'

function stubFetch() {
  const calls: { url: string; method: string }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    // A brand-new contact: the read says 404.
    if (method === 'GET') return new Response('{}', { status: 404 })
    return new Response(JSON.stringify({ id: '1' }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

async function load(env: Record<string, string>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('./hubspot')
}

beforeEach(() => {
  insert.mockClear()
  sendEmail.mockClear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const CONFIGURED = {
  HUBSPOT_ACCESS_TOKEN: 'test-token',
  HUBSPOT_PORTAL_ID: '24379847',
  HUBSPOT_FORM_EVENT_NOTIFY: 'form-guid',
}

describe('captureLead under HUBSPOT_DRY_RUN=1', () => {
  it('reads, but writes nothing to HubSpot and dead-letters nothing', async () => {
    const calls = stubFetch()
    const { captureLead } = await load({ ...CONFIGURED, HUBSPOT_DRY_RUN: '1' })

    const result = await captureLead({
      email: EMAIL,
      source: 'event_notify',
      activity: 'test',
      lifecycleStage: 'subscriber',
      logEntry: '2026-11-14 · Event Notify · test',
    })

    expect(result.ok).toBe(true)
    expect(result.via).toBe('form')
    // Only reads reached the network.
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    expect(calls.some((c) => c.url.includes('/submissions/'))).toBe(false)
    expect(insert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()

    // Each skipped write was logged: the form post, the lifecycle stamp, the note.
    const lines = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[hubspot] dry-run POST /submissions/v3/integration/secure/submit/24379847/form-guid')
    expect(lines).toContain('[hubspot] dry-run POST /crm/v3/objects/notes')
    expect(lines.some((l) => l.startsWith('[hubspot] dry-run PATCH /crm/v3/objects/contacts/<email>'))).toBe(true)
    expect(lines.join('\n')).not.toContain('example.com')
  })

  it('skips the unauthenticated form post too, when there is no token', async () => {
    const calls = stubFetch()
    const { captureLead } = await load({
      HUBSPOT_ACCESS_TOKEN: '',
      HUBSPOT_PORTAL_ID: '24379847',
      HUBSPOT_FORM_EVENT_NOTIFY: 'form-guid',
      HUBSPOT_DRY_RUN: '1',
    })

    const result = await captureLead({ email: EMAIL, source: 'event_notify', activity: 'test' })

    expect(result.ok).toBe(true)
    expect(calls).toEqual([])
    expect(insert).not.toHaveBeenCalled()
  })

  it('is unchanged with the variable unset: the form submission is posted', async () => {
    const calls = stubFetch()
    const { captureLead } = await load({ ...CONFIGURED, HUBSPOT_DRY_RUN: '' })

    const result = await captureLead({ email: EMAIL, source: 'event_notify', activity: 'test' })

    expect(result.ok).toBe(true)
    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url === 'https://api.hsforms.com/submissions/v3/integration/secure/submit/24379847/form-guid',
      ),
    ).toBe(true)
  })

  it('is ignored on production: the form submission is posted, with one warning', async () => {
    const calls = stubFetch()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { captureLead } = await load({ ...CONFIGURED, HUBSPOT_DRY_RUN: '1', NEXT_PUBLIC_APP_ENV: 'prod' })

    const result = await captureLead({ email: EMAIL, source: 'event_notify', activity: 'test' })

    expect(result.ok).toBe(true)
    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url === 'https://api.hsforms.com/submissions/v3/integration/secure/submit/24379847/form-guid',
      ),
    ).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HUBSPOT_DRY_RUN is set on a production deployment and is ignored'))
  })
})
