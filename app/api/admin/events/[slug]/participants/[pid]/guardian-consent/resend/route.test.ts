// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'

// S5 wave 8 CONSENT (c): staff resend a pending guardian consent's form. The form
// goes to the guardian on the envelope, from the organiser's sender: an invitation
// that never went is sent, one that went is chased on the same envelope. Stellr's
// events have no consent rows, so they get a 404 and nothing is sent.

const TENANT = '11111111-1111-4111-8111-111111111111'
const PID = '22222222-2222-4222-8222-222222222222'
const REG = '33333333-3333-4333-8333-333333333333'
const AGR = '44444444-4444-4444-8444-444444444444'
const CONSENT = '55555555-5555-4555-8555-555555555555'

const h = vi.hoisted(() => ({
  crew: { ok: true } as Record<string, unknown>,
  participant: null as unknown,
  envelope: { envelope_id: 'native-x', provider: 'native', status: 'sent' } as unknown,
  mailOn: true,
  sender: { from: 'Organiser via Stellr <events@example.test>', replyTo: 'organiser@example.test' } as unknown,
  // Signers after the reminder: by default the guardian, stamped by this send.
  recipients: vi.fn(async (..._a: unknown[]): Promise<unknown[]> => [{ status: 'sent', invite_sent_at: new Date().toISOString() }]),
  loadCalls: [] as Array<{ table: string; id: string }>,
  consent: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  invite: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ ok: true, result: { sent: 1, deferred: 0, failed: 0 } })),
  remind: vi.fn(async (..._a: unknown[]): Promise<number> => 1),
  limit: vi.fn(async (..._a: unknown[]) => ({ ok: true, retryAfterSeconds: 0 })),
  audits: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ tag: 'db' }) }))
vi.mock('@/lib/authz', () => ({ requireEventRoute: async () => h.crew }))
vi.mock('@/lib/audit/route', () => ({
  withAudit: (spec: (c: { args: unknown[] }) => unknown, fn: (...a: unknown[]) => Promise<Response>) =>
    async (...args: unknown[]) => {
      const res = await fn(...args)
      if (res.ok) h.audits.push(spec({ args }))
      return res
    },
}))
vi.mock('@/lib/tenancy/load-scoped', () => ({
  loadRecord: async (_scope: unknown, table: string, id: string, opts: { notFound: () => Response }) => {
    h.loadCalls.push({ table, id })
    const row = table === 'participants' ? h.participant : h.envelope
    return row ? { ok: true, row } : { ok: false, response: opts.notFound() }
  },
}))
vi.mock('@/lib/rate-limit-async', () => ({ limit: h.limit }))
vi.mock('@/lib/esign/operations', () => ({ remindEnvelopeRow: h.remind }))
vi.mock('@/lib/esign/native/flow', () => ({ loadRecipients: h.recipients }))
vi.mock('@/lib/event-emails/tenant-mail', async (orig) => ({
  ...(await orig<typeof import('@/lib/event-emails/tenant-mail')>()),
  tenantEventMailEnabled: () => h.mailOn,
  loadTenantSender: async () => h.sender,
}))
vi.mock('@/lib/event-emails/tenant-signing', () => ({
  sendTenantSigningInvitation: h.invite,
  TENANT_SIGNING_FAILED: 'signing failed text',
}))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({
  GUARDIAN_INVITES_PER_TENANT_PER_HOUR: 30,
  pendingConsentForParticipant: h.consent,
}))

const { TenantSenderRequiredError, TENANT_SENDER_REQUIRED } = await import('@/lib/event-emails/tenant-mail')
const { POST } = await import('./route')

const call = async () => {
  const res = await POST(new Request(`https://app.example.test/api/admin/events/ev/participants/${PID}/guardian-consent/resend`, { method: 'POST' }), {
    params: Promise.resolve({ slug: 'ev', pid: PID }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const pendingRow = { id: CONSENT, tenant_id: TENANT, registration_id: REG, agreement_id: AGR }

beforeEach(() => {
  vi.clearAllMocks()
  h.audits = []
  h.loadCalls = []
  h.crew = { ok: true, userId: 'user_crew', tenantId: TENANT, scope: { tenantId: TENANT }, isAdmin: false }
  h.participant = { id: PID, registration_id: REG, registrations: { event_slug: 'ev' } }
  h.envelope = { envelope_id: 'native-x', provider: 'native', status: 'sent' }
  h.mailOn = true
  h.sender = { from: 'Organiser via Stellr <events@example.test>', replyTo: 'organiser@example.test' }
  h.consent.mockResolvedValue(pendingRow)
})

describe('guardian consent resend', () => {
  it('is a registered audit action', () => {
    expect(AUDIT_ACTIONS).toContain('registration.guardian_consent.resend')
  })

  it('refuses without event access, reading nothing', async () => {
    h.crew = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    expect((await call()).status).toBe(403)
    expect(h.consent).not.toHaveBeenCalled()
    expect(h.invite).not.toHaveBeenCalled()
  })

  it('a participant of another event is not found', async () => {
    h.participant = { id: PID, registration_id: REG, registrations: [{ event_slug: 'other' }] }
    expect((await call()).status).toBe(404)
    expect(h.consent).not.toHaveBeenCalled()
  })

  it("Stellr's event (no consent row): 404, nothing sent", async () => {
    h.consent.mockResolvedValue(null)
    const { status, body } = await call()
    expect(status).toBe(404)
    expect(body.code).toBe('no_pending_consent')
    expect(h.invite).not.toHaveBeenCalled()
    expect(h.remind).not.toHaveBeenCalled()
    expect(h.limit).not.toHaveBeenCalled()
    expect(h.audits).toEqual([])
  })

  it('a consent from an earlier registration is not this one', async () => {
    h.consent.mockResolvedValue({ ...pendingRow, registration_id: 'old-reg' })
    expect((await call()).status).toBe(404)
    expect(h.invite).not.toHaveBeenCalled()
  })

  it('no envelope issued: 409, nothing sent', async () => {
    h.consent.mockResolvedValue({ ...pendingRow, agreement_id: null })
    const { status, body } = await call()
    expect(status).toBe(409)
    expect(body.code).toBe('consent_not_issued')
    expect(h.invite).not.toHaveBeenCalled()
  })

  it('a failed consent read is a 500, never a send', async () => {
    h.consent.mockRejectedValue(new Error('down'))
    expect((await call()).status).toBe(500)
    expect(h.invite).not.toHaveBeenCalled()
  })

  it('an invitation that never went is sent, from the envelope, and audited with ids only', async () => {
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, outcome: 'sent' })
    expect(h.invite).toHaveBeenCalledWith({ tag: 'db' }, { tenantId: TENANT, envelopeRowId: AGR })
    expect(h.remind).not.toHaveBeenCalled()
    expect(h.audits).toEqual([
      {
        action: 'registration.guardian_consent.resend',
        actor: { userId: 'user_crew' },
        tenant: { tenantId: TENANT },
        target: { table: 'participants', id: PID },
        metadata: { event_slug: 'ev', consent_id: CONSENT, event_tenant_id: TENANT },
      },
    ])
  })

  it('an invitation waiting in the outbox answers deferred', async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 1, failed: 0 } })
    expect((await call()).body).toEqual({ ok: true, outcome: 'deferred' })
  })

  it('an invitation already sent: the guardian is reminded on the same envelope', async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 0, failed: 0 } })
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, outcome: 'reminded' })
    expect(h.loadCalls).toContainEqual({ table: 'agreements', id: AGR })
    expect(h.remind).toHaveBeenCalledWith({ tag: 'db' }, { envelope_id: 'native-x', provider: 'native' })
    expect(h.recipients).toHaveBeenCalledWith({ tag: 'db' }, AGR)
  })

  it('a reminder the outbox holds answers deferred, never reminded', async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 0, failed: 0 } })
    // Held for the day's allowance: the outbox clears the stamp, or leaves the old one.
    for (const stamp of [null, '2026-11-01T00:00:00.000Z']) {
      h.recipients.mockResolvedValueOnce([{ status: 'sent', invite_sent_at: stamp }])
      const { status, body } = await call()
      expect(status).toBe(200)
      expect(body).toEqual({ ok: true, outcome: 'deferred', reminder: true })
    }
  })

  it.each([
    ['the form is no longer out', () => { h.envelope = { envelope_id: 'native-x', provider: 'native', status: 'completed' } }, 409, 'not_out_for_signature'],
    ["the organiser's mail is off", () => { h.mailOn = false }, 409, 'tenant_mail_off'],
    ['the organiser has no usable sender', () => { h.sender = null }, 409, 'no_sender'],
    ['the envelope is not found', () => { h.envelope = null }, 404, 'no_pending_consent'],
    ["the consent claims Stellr's tenant", () => { h.consent.mockResolvedValue({ ...pendingRow, tenant_id: null }) }, 404, 'no_pending_consent'],
  ])('refused before any cap is spent when %s', async (_why, arrange, status, code) => {
    arrange()
    const res = await call()
    expect(res.status).toBe(status)
    expect(res.body.code).toBe(code)
    expect(h.limit).not.toHaveBeenCalled()
    expect(h.invite).not.toHaveBeenCalled()
    expect(h.remind).not.toHaveBeenCalled()
    expect(h.audits).toEqual([])
  })

  it('a reminder with nobody left to chase is not out for signing', async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 0, failed: 0 } })
    h.remind.mockResolvedValue(0)
    const { status, body } = await call()
    expect(status).toBe(409)
    expect(body.code).toBe('not_out_for_signature')
    expect(h.audits).toEqual([])
  })

  it("a reminder without the organiser's sender is refused, never sent as Stellr", async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 0, failed: 0 } })
    h.remind.mockRejectedValue(new TenantSenderRequiredError())
    const { status, body } = await call()
    expect(status).toBe(409)
    expect(body).toEqual({ code: 'no_sender', error: TENANT_SENDER_REQUIRED })
  })

  it('a failed reminder is a 502 with fixed text', async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 0, failed: 0 } })
    h.remind.mockRejectedValue(new Error('db detail'))
    const { status, body } = await call()
    expect(status).toBe(502)
    expect(body).toEqual({ error: 'signing failed text' })
  })

  it.each([
    ['disabled', 409, 'tenant_mail_off'],
    ['no_sender', 409, 'no_sender'],
    ['not_out_for_signature', 409, 'not_out_for_signature'],
    ['not_found', 404, 'no_pending_consent'],
    ['stellr', 404, 'no_pending_consent'],
    ['failed', 502, undefined],
  ])('a refused invitation (%s) answers %i and sends no reminder', async (reason, status, code) => {
    h.invite.mockResolvedValue({ ok: false, reason })
    const res = await call()
    expect(res.status).toBe(status)
    expect(res.body.code).toBe(code)
    expect(h.remind).not.toHaveBeenCalled()
    expect(h.audits).toEqual([])
  })

  it('a failed send is a 502', async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 0, failed: 1 } })
    expect((await call()).status).toBe(502)
    expect(h.remind).not.toHaveBeenCalled()
  })

  it('caps per consent, then per organiser, before anything is sent', async () => {
    h.limit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 60 })
    let res = await call()
    expect(res.status).toBe(429)
    expect(res.body.code).toBe('guardian_consent_busy')
    expect(h.invite).not.toHaveBeenCalled()
    expect(h.limit).toHaveBeenCalledWith(`tenant-guardian-consent:resend:${CONSENT}`, expect.objectContaining({ limit: 3, tenantId: TENANT }))

    h.limit.mockResolvedValueOnce({ ok: true, retryAfterSeconds: 0 }).mockResolvedValueOnce({ ok: false, retryAfterSeconds: 60 })
    res = await call()
    expect(res.status).toBe(429)
    expect(h.limit).toHaveBeenLastCalledWith('tenant-guardian-consent:invitations', expect.objectContaining({ limit: 30, tenantId: TENANT }))
    expect(h.invite).not.toHaveBeenCalled()
  })
})
