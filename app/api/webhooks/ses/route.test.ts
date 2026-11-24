// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ valid: true, recorded: [] as unknown[], suppressed: [] as unknown[] }))
vi.mock('@/lib/email/sns', async () => {
  const real = await vi.importActual<typeof import('@/lib/email/sns')>('@/lib/email/sns')
  return { ...real, verifySnsMessage: async () => h.valid }
})
vi.mock('@/lib/email/events', async () => {
  const real = await vi.importActual<typeof import('@/lib/email/events')>('@/lib/email/events')
  return { ...real, recordMappedEmailEvent: async (_db: unknown, m: unknown) => (h.recorded.push(m), { recorded: true, type: null }) }
})
vi.mock('@/lib/email/suppressions', async () => {
  const real = await vi.importActual<typeof import('@/lib/email/suppressions')>('@/lib/email/suppressions')
  return { ...real, recordSuppression: async (_db: unknown, s: unknown) => (h.suppressed.push(s), true) }
})
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))

const TOPIC = 'arn:aws:sns:us-east-2:931017478540:stellr-ses-events'
const { POST } = await import('./route')
const post = (body: unknown) => POST(new Request('https://app.example.test/api/webhooks/ses', { method: 'POST', body: JSON.stringify(body) }))
const note = (event: unknown, topic = TOPIC) => ({ Type: 'Notification', MessageId: 'n1', TopicArn: topic, Message: JSON.stringify(event), Timestamp: '2026-11-24T00:00:00Z', SignatureVersion: '2', Signature: 'x', SigningCertURL: 'https://sns.us-east-2.amazonaws.com/c.pem' })
const mail = { messageId: 'ses-1', timestamp: '2026-11-24T01:00:00Z', destination: ['a@example.org'], tags: { stream: ['transactional'] } }

beforeEach(() => {
  vi.stubEnv('SES_SNS_TOPIC_ARN', TOPIC)
  h.valid = true
  h.recorded = []
  h.suppressed = []
})

describe('POST /api/webhooks/ses', () => {
  it('refuses a bad signature and a different topic', async () => {
    h.valid = false
    expect((await post(note({ eventType: 'Delivery', mail }))).status).toBe(401)
    h.valid = true
    expect((await post(note({ eventType: 'Delivery', mail }, 'arn:aws:sns:us-east-2:1:other'))).status).toBe(403)
    expect(h.recorded).toEqual([])
  })
  it('is refused outright without the topic configured', async () => {
    vi.stubEnv('SES_SNS_TOPIC_ARN', '')
    expect((await post(note({ eventType: 'Delivery', mail }))).status).toBe(500)
  })
  it('stores a delivery', async () => {
    const res = await post(note({ eventType: 'Delivery', mail, delivery: { recipients: ['a@example.org'] } }))
    expect(await res.json()).toEqual({ recorded: 1 })
    expect(h.suppressed).toEqual([])
  })
  it('suppresses a permanent bounce and a complaint, not a transient bounce', async () => {
    await post(note({ eventType: 'Bounce', mail, bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'a@example.org' }] } }))
    await post(note({ eventType: 'Bounce', mail, bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'b@example.org' }] } }))
    await post(note({ eventType: 'Complaint', mail, complaint: { complainedRecipients: [{ emailAddress: 'c@example.org' }] } }))
    expect(h.suppressed).toEqual([
      { email: 'a@example.org', reason: 'bounce', source: 'ses-bounce' },
      { email: 'c@example.org', reason: 'complaint', source: 'ses-complaint' },
    ])
    expect(h.recorded).toHaveLength(3)
  })
  it('confirms a subscription only through an SNS URL', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const sub = { ...note({}), Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.us-east-2.amazonaws.com/?Action=ConfirmSubscription&Token=t', Token: 't' }
    expect((await post(sub)).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(sub.SubscribeURL)
    expect((await post({ ...sub, SubscribeURL: 'https://evil.example/' })).status).toBe(400)
    vi.unstubAllGlobals()
  })
})
