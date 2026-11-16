import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PUB-2 / HTML-injection cluster: the public Host An Event form
// interpolates its fields into a Stellr-branded HTML email to staff. Every
// field is escaped so a submission can't inject markup.

const { sendEmail, captureLead } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => undefined),
  captureLead: vi.fn(async (_input: unknown) => ({ ok: true, via: 'form' as const, noteLogged: true, warnings: [] })),
}))

vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/hubspot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hubspot')>('@/lib/hubspot')
  return { ...actual, captureLead, readHubspotCookie: () => undefined }
})
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

beforeEach(() => vi.clearAllMocks())

const XSS = '<img src=x onerror=alert(1)>'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://www.stellreducation.org/api/host-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const VALID = {
  firstName: 'Dana', lastName: 'Reyes', email: 'dana@example.com', phone: '555-0100',
  companySchool: 'Acme HS', venueCapacity: '200', preferredTiming: 'Spring', preferredDuration: '1 day',
}

describe('host-event email escaping (PUB-2)', () => {
  it('escapes every submitted field in the HTML body', async () => {
    await post({ ...VALID, companySchool: XSS, firstName: XSS, preferredTiming: XSS })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const html = (sendEmail.mock.calls[0][0] as { html: string }).html
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})

// spam.L1b / spam.L3 (docs/REC-form-spam-hardening.md §3, §5).
const timing = () => ({ website: '', renderedAt: Date.now() - 60_000, submittedAt: Date.now() })

describe('host-event spam guard and validation', () => {
  it('sends and captures a valid submission as before, without the spam fields', async () => {
    const res = await post({ ...VALID, consent: true, ...timing() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(captureLead).toHaveBeenCalledTimes(1)
    expect((sendEmail.mock.calls[0][0] as { text: string }).text).not.toMatch(/renderedAt|website/)
  })

  it('answers a filled honeypot with 200 and sends and captures nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ ...VALID, ...timing(), website: 'https://spam.example' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(captureLead).not.toHaveBeenCalled()
  })

  it.each([
    ['an over-long overheads note', { facilityOverheads: 'a'.repeat(5001) }],
    ['an over-long organization', { companySchool: 'a'.repeat(201) }],
    ['a malformed email', { email: 'dana-at-example' }],
  ])('refuses %s with 400 and sends nothing', async (_label, patch) => {
    const res = await post({ ...VALID, ...timing(), ...patch })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing required fields' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(captureLead).not.toHaveBeenCalled()
  })
})
