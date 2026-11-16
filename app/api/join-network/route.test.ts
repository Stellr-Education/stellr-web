import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PUB-2 / HTML-injection cluster: the public Join The Network form
// interpolates its fields into a Stellr-branded HTML email to staff. Every
// field is escaped so a submission can't inject markup.

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async (_opts: unknown) => undefined) }))

vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

beforeEach(() => vi.clearAllMocks())

const XSS = '<img src=x onerror=alert(1)>'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://www.stellreducation.org/api/join-network', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const VALID = {
  firstName: 'Dana', lastName: 'Reyes', email: 'dana@example.com', phone: '555-0100',
  companyName: 'Acme', whatYouDo: 'robotics', reason: 'sponsor',
}

describe('join-network email escaping (PUB-2)', () => {
  it('escapes every submitted field in the HTML body', async () => {
    await post({ ...VALID, companyName: XSS, whatYouDo: XSS, firstName: XSS })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})

// spam.L1b / spam.L3 (docs/REC-form-spam-hardening.md §3, §5).
const timing = () => ({ website: '', renderedAt: Date.now() - 60_000, submittedAt: Date.now() })

describe('join-network spam guard and validation', () => {
  it('sends a valid submission as before, without the spam fields', async () => {
    const res = await post({ ...VALID, consent: true, ...timing() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect((sendEmail.mock.calls[0][0] as { text: string }).text).not.toMatch(/renderedAt|website/)
  })

  it('answers a filled honeypot with 200 and sends nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ ...VALID, ...timing(), website: 'https://spam.example' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    ['an over-long description', { whatYouDo: 'a'.repeat(5001) }],
    ['an over-long partner type', { reason: 'a'.repeat(121) }],
  ])('refuses %s with 400 and sends nothing', async (_label, patch) => {
    const res = await post({ ...VALID, ...timing(), ...patch })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing required fields' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
