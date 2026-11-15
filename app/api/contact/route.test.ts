import { describe, it, expect, vi, beforeEach } from 'vitest'

// spam.L1b / spam.L3 (docs/REC-form-spam-hardening.md §3, §5): the contact
// route validates with zod and length caps, and a tripped honeypot or timing
// trap answers 200 while emailing nobody.

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async (_opts: unknown) => undefined) }))

vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const VALID = { name: 'A Teacher', email: 'teacher@example.test', type: 'General', message: 'How do we register a class?' }
const timing = () => ({ website: '', renderedAt: Date.now() - 60_000, submittedAt: Date.now() })

describe('POST /api/contact', () => {
  it('sends a valid submission to the team inbox, without the spam fields', async () => {
    const res = await post({ ...VALID, consent: true, ...timing() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const { subject, replyTo, text } = sendEmail.mock.calls[0][0] as { subject: string; replyTo: string; text: string }
    expect(subject).toBe('[General] New enquiry from A Teacher')
    expect(replyTo).toBe('teacher@example.test')
    expect(text).not.toMatch(/renderedAt|website/)
  })

  // Only the six offered types reach the inbox; a bot's own text is filed as
  // Other rather than refused, so the answer for it is unchanged.
  it('files an inquiry type the form does not offer as Other', async () => {
    const res = await post({ ...VALID, ...timing(), type: 'Buy cheap watches' })
    expect(res.status).toBe(200)
    const { subject } = sendEmail.mock.calls[0][0] as { subject: string }
    expect(subject).toBe('[Other] New enquiry from A Teacher')
  })

  it('refuses an over-long inquiry type with 400', async () => {
    const res = await post({ ...VALID, ...timing(), type: 'a'.repeat(61) })
    expect(res.status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('still accepts a body from a page cached before the timing field existed', async () => {
    const res = await post(VALID)
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('answers a filled honeypot with 200 and sends nothing', async () => {
    const res = await post({ ...VALID, ...timing(), website: 'https://spam.example' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('answers an instant submission in production with 200 and sends nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    try {
      const res = await post({ ...VALID, website: '', renderedAt: Date.now() })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(sendEmail).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    ['an over-long message', { message: 'a'.repeat(5001) }],
    ['an over-long name', { name: 'a'.repeat(121) }],
    ['a malformed email', { email: 'not-an-email' }],
    ['a missing field', { message: undefined }],
  ])('refuses %s with 400 and sends nothing', async (_label, patch) => {
    const res = await post({ ...VALID, ...timing(), ...patch })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Missing required fields' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
