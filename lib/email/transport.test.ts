// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailSendError, resendTags, resendTransport, type OutgoingEmail } from './transport'

const base: OutgoingEmail = {
  from: 'Stellr <no-reply@mail.example.test>',
  to: ['parent@example.test'],
  cc: [],
  replyTo: 'hello@example.test',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
}

function mockFetch(res: { ok: boolean; status?: number; body?: unknown; text?: string }) {
  const fn = vi.fn(async () => ({
    ok: res.ok,
    status: res.status ?? (res.ok ? 200 : 500),
    json: async () => res.body,
    text: async () => res.text ?? '',
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resendTransport', () => {
  it('posts exactly the request sendEmail always made', async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: 're_123' } })
    const out = await resendTransport('key_abc').send(base)
    expect(out).toEqual({ id: 're_123' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer key_abc', 'Content-Type': 'application/json' })
    // Field names AND order, so the wire format is byte-for-byte unchanged.
    expect(init.body).toBe(JSON.stringify({
      from: base.from, to: base.to, cc: [], reply_to: base.replyTo, subject: 'Hello', html: '<p>Hi</p>', text: 'Hi',
    }))
  })

  it('adds headers and attachments only when there are some', async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: 're_1' } })
    await resendTransport('k').send({
      ...base,
      headers: { 'List-Unsubscribe': '<https://example.test/u>' },
      attachments: [{ filename: 'a.ics', content: 'QQ==', contentType: 'text/calendar' }],
    })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.headers).toEqual({ 'List-Unsubscribe': '<https://example.test/u>' })
    expect(body.attachments).toEqual([{ filename: 'a.ics', content: 'QQ==', content_type: 'text/calendar' }])

    await resendTransport('k').send({ ...base, headers: {}, attachments: [] })
    const bare = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect('headers' in bare).toBe(false)
    expect('attachments' in bare).toBe(false)
  })

  it('throws EmailSendError with the status, and logs only the domain', async () => {
    mockFetch({ ok: false, status: 429, text: 'daily quota' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = await resendTransport('k').send(base).catch((e) => e)
    expect(err).toBeInstanceOf(EmailSendError)
    expect(err.status).toBe(429)
    expect(err.isQuota).toBe(true)
    expect(err.message).toBe('Failed to send email: daily quota')
    expect(JSON.stringify(log.mock.calls)).not.toContain('parent@')
  })

  it('returns a null id when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('nope') }, text: async () => '' })))
    expect(await resendTransport('k').send(base)).toEqual({ id: null })
  })
})

describe('Resend tags', () => {
  it('sends tags as name/value pairs, and leaves the field out when there are none', async () => {
    const fetchMock = mockFetch({ ok: true, body: { id: 're_t' } })
    await resendTransport('k').send({ ...base, tags: { stream: 'marketing', tenant: '00000000-0000-4000-8000-000000000001' } })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.tags).toEqual([
      { name: 'stream', value: 'marketing' },
      { name: 'tenant', value: '00000000-0000-4000-8000-000000000001' },
    ])
    await resendTransport('k').send({ ...base, tags: {} })
    const bare = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect('tags' in bare).toBe(false)
  })

  it('replaces characters Resend would reject and drops empty tags, so a tag never fails a send', () => {
    expect(resendTags({ 'feat ure': 'event.email/1', empty: '', ok: 'a-b_c' })).toEqual([
      { name: 'feat_ure', value: 'event_email_1' },
      { name: 'ok', value: 'a-b_c' },
    ])
    expect(resendTags({ ref: 'x'.repeat(300) })[0].value).toHaveLength(256)
    expect(resendTags(undefined)).toEqual([])
  })
})
