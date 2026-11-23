// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDomain, getDomain, removeDomain, ResendDomainError, verifyDomain } from './resend-domains'

let fetchMock: ReturnType<typeof vi.fn>
const respond = (ok: boolean, body: unknown, status = ok ? 200 : 422) =>
  fetchMock.mockResolvedValueOnce({ ok, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('RESEND_API_KEY', 're_test')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Resend domains API', () => {
  it('creates a domain in us-east-1 and returns its records', async () => {
    respond(true, { id: 'd1', name: 'mail.example.org', status: 'not_started', records: [{ record: 'DKIM', name: 'x', type: 'TXT', value: 'p=', status: 'not_started' }] })
    const d = await createDomain('mail.example.org')
    expect(d).toMatchObject({ id: 'd1', status: 'not_started' })
    expect(d.records).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/domains')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'mail.example.org', region: 'us-east-1' })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test')
  })

  it('reads, verifies and removes by id, escaping it', async () => {
    respond(true, { id: 'd1', name: 'n', status: 'verified', records: [] })
    respond(true, {})
    respond(true, '')
    expect((await getDomain('d/1')).status).toBe('verified')
    await verifyDomain('d1')
    await removeDomain('d1')
    expect(fetchMock.mock.calls.map((c) => [(c[1] as RequestInit).method, c[0]])).toEqual([
      ['GET', 'https://api.resend.com/domains/d%2F1'],
      ['POST', 'https://api.resend.com/domains/d1/verify'],
      ['DELETE', 'https://api.resend.com/domains/d1'],
    ])
  })

  it('maps an unknown status to pending, never to verified', async () => {
    respond(true, { id: 'd1', name: 'n', status: 'something_new', records: [] })
    expect((await getDomain('d1')).status).toBe('pending')
  })

  it("throws Resend's message and status on a refusal", async () => {
    respond(false, { name: 'validation_error', message: 'Domain already exists' }, 422)
    await expect(createDomain('mail.example.org')).rejects.toMatchObject({ name: 'ResendDomainError', status: 422, message: 'Domain already exists' })
  })

  it('refuses without an API key', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    await expect(getDomain('d1')).rejects.toBeInstanceOf(ResendDomainError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
