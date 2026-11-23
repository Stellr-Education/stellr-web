// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Webhook } from 'svix'
import { fakeSupabase } from '@/test/fake-supabase'

const { db } = vi.hoisted(() => ({ db: { current: null as unknown } }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.current }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: vi.fn(async () => {}) }))

import { POST } from './route'

const secret = `whsec_${Buffer.from('c'.repeat(32)).toString('base64')}`

function signed(body: string, opts: { secret?: string } = {}) {
  const id = 'msg_s1'
  const at = new Date()
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
      'svix-signature': new Webhook(opts.secret ?? secret).sign(id, at, body),
    },
  })
}

function setup() {
  const fake = fakeSupabase({ agreement_recipients: [], email_suppressions: [] })
  db.current = fake.client
  return fake
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/resend — suppression list', () => {
  it('refuses every call when RESEND_WEBHOOK_SECRET is unset', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '')
    const fake = setup()
    const res = await POST(signed(JSON.stringify({ type: 'email.complained', data: { to: ['a@example.test'] } })))
    expect(res.status).toBe(500)
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })

  it('refuses a missing or forged signature', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const body = JSON.stringify({ type: 'email.complained', data: { to: ['a@example.test'] } })
    const unsigned = await POST(new Request('http://localhost/api/webhooks/resend', { method: 'POST', body }))
    expect(unsigned.status).toBe(400)
    const forged = await POST(signed(body, { secret: `whsec_${Buffer.from('d'.repeat(32)).toString('base64')}` }))
    expect(forged.status).toBe(400)
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })

  it('records a complaint and a hard bounce, idempotently', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const complaint = JSON.stringify({ type: 'email.complained', data: { email_id: 're_1', to: ['Parent@Example.test'] } })
    const first = await POST(signed(complaint))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ received: true, suppressed: 1, bounced: 0, recorded: false })
    // Resend redelivers: nothing changes.
    expect((await POST(signed(complaint))).status).toBe(200)
    const bounce = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_2', to: ['gone@example.test'], bounce: { type: 'Permanent' } } })
    expect((await POST(signed(bounce))).status).toBe(200)
    expect(fake.table('email_suppressions').map((r) => [r.email, r.reason])).toEqual([
      ['parent@example.test', 'complaint'],
      ['gone@example.test', 'bounce'],
    ])
  })

  it('acknowledges events it does not act on', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const res = await POST(signed(JSON.stringify({ type: 'email.delivered', data: { to: ['a@example.test'] } })))
    expect(await res.json()).toEqual({ received: true, suppressed: 0, bounced: 0, recorded: false })
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })

  // Review finding: the suppression write ran first and threw, so a deploy that
  // lands before the migration (or any failed upsert) stopped signing-invitation
  // bounces being recorded. The e-sign half now runs first and on its own.
  it('records a signing-invitation bounce even when the suppression write fails', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = fakeSupabase(
      {
        agreement_recipients: [{ id: 'r1', envelope_row: 'env-1', email: 'parent@example.test', status: 'sent', invite_email_id: 're_1' }],
        agreements: [{ id: 'env-1', event_title: 'Nevada', minor_name: 'Kid', signer_name: 'Parent' }],
        email_suppressions: [],
      },
      { failOn: (t) => (t === 'email_suppressions' ? 'relation "public.email_suppressions" does not exist' : null) },
    )
    db.current = fake.client
    const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_1', to: ['parent@example.test'], bounce: { type: 'Permanent', message: 'No such user' } } })
    const res = await POST(signed(body))
    // The bounce is on the roster and staff were told…
    expect(fake.table('agreement_recipients')[0]).toMatchObject({ status: 'autoresponded' })
    const { notifyCommunityAdmins } = await import('@/lib/notify')
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
    // …and the 500 asks Resend to retry the suppression half. The retry does
    // not alert twice: the signer is no longer 'sent'.
    expect(res.status).toBe(500)
    await POST(signed(body))
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
  })

  it('still records the suppression when the e-sign half fails', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = fakeSupabase(
      { agreement_recipients: [], email_suppressions: [] },
      { failOn: (t) => (t === 'agreement_recipients' ? 'boom' : null) },
    )
    db.current = fake.client
    const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_9', to: ['gone@example.test'], bounce: { type: 'Permanent' } } })
    const res = await POST(signed(body))
    expect(res.status).toBe(500)
    expect(fake.table('email_suppressions').map((r) => r.email)).toEqual(['gone@example.test'])
  })

  it('rejects a signed body that is not an event', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    setup()
    expect((await POST(signed('null'))).status).toBe(400)
  })
})

describe('POST /api/webhooks/resend — email events store', () => {
  const delivered = (id = 're_d1', at = '2026-11-23T20:00:00.000Z') =>
    JSON.stringify({ type: 'email.delivered', created_at: at, data: { email_id: id, created_at: '2026-11-23T19:59:58.000Z', to: ['Parent@Example.test'] } })

  it('records every event once, however often Resend redelivers it', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const first = await POST(signed(delivered()))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ received: true, suppressed: 0, bounced: 0, recorded: true })
    const again = await POST(signed(delivered()))
    expect(await again.json()).toMatchObject({ recorded: false })
    expect(fake.table('email_events')).toHaveLength(1)
    expect(fake.table('email_events')[0]).toMatchObject({ type: 'delivered', provider_email_id: 're_d1', recipient: 'parent@example.test' })
  })

  it('a complaint is suppressed and stored', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const body = JSON.stringify({ type: 'email.complained', created_at: '2026-11-23T20:00:00.000Z', data: { email_id: 're_c1', to: ['a@example.test'] } })
    expect(await (await POST(signed(body))).json()).toEqual({ received: true, suppressed: 1, bounced: 0, recorded: true })
    expect(fake.table('email_events').map((r) => r.type)).toEqual(['complained'])
  })

  it('a failed events write asks Resend to retry, after the suppression is in', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = fakeSupabase(
      { agreement_recipients: [], email_suppressions: [] },
      { failOn: (t, action) => (t === 'email_events' && action === 'upsert' ? 'relation "public.email_events" does not exist' : null) },
    )
    db.current = fake.client
    const body = JSON.stringify({ type: 'email.bounced', created_at: '2026-11-23T20:00:00.000Z', data: { email_id: 're_b1', to: ['gone@example.test'], bounce: { type: 'Permanent' } } })
    const res = await POST(signed(body))
    expect(res.status).toBe(500)
    expect(fake.table('email_suppressions').map((r) => r.email)).toEqual(['gone@example.test'])
  })
})
