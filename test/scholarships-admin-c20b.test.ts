// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 wave 8, C20b: the scholarship admin routes load their application through loadScoped
// (lib/scholarship-admin.ts loadStellrScholarship) and are Stellr-only for other tenants
// (WD-4 and SQ-16 defaults: no scholarships for a tenant's event until S9). Another
// tenant's event answers as a missing application for a Stellr admin too, before any email,
// Stripe call or write; a failed read of the event's owner is a retryable 503. Stellr's own
// applications answer exactly as before.

const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'
const APP_ID = '22222222-2222-4222-8222-222222222222'
const REG_ID = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  hasCapability: vi.fn(async (_cap: string) => true),
  appRow: { current: null as Record<string, unknown> | null },
  regRow: { current: null as Record<string, unknown> | null },
  events: new Map<string, { data: unknown; error: unknown }>(),
  reads: [] as string[],
  writes: [] as string[],
  offerScholarship: vi.fn(async (_db: unknown, _input: unknown) => ({ ok: true, registrationId: 'reg-new', emailedTo: ['a@example.com'], refund: null })),
  markNotOffered: vi.fn(async (_db: unknown, _id: string, _r: unknown) => ({ ok: true })),
  sendScholarshipOfferEmails: vi.fn(async (_db: unknown, _id: string) => ['a@example.com']),
  cancelScholarship: vi.fn(async (_db: unknown, _id: string, _input: unknown) => ({ ok: true, message: 'Cancelled', amountDueRestoredCents: 0 })),
  quoteScholarshipRefund: vi.fn(async (_db: unknown, _s: unknown, _reg: string, _p: number) => ({ status: 'refund', refundCents: 500 })),
  issueScholarshipRefund: vi.fn(async (_db: unknown, _s: unknown, _input: unknown) => ({ type: 'cash', refundCents: 500, detail: 'ok' })),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_admin' }) }))
vi.mock('@/lib/authz', () => ({ hasCapability: h.hasCapability, currentTenantId: () => STELLR_TENANT_ID }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'm-admin', first_name: 'Ada', last_name: 'Admin' }) }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/scholarship-offer', () => ({
  offerScholarship: h.offerScholarship,
  markNotOffered: h.markNotOffered,
  sendScholarshipOfferEmails: h.sendScholarshipOfferEmails,
}))
vi.mock('@/lib/scholarship-cancel', () => ({ cancelScholarship: h.cancelScholarship }))
vi.mock('@/lib/scholarship-refund', async (orig) => ({
  ...(await orig<typeof import('@/lib/scholarship-refund')>()),
  quoteScholarshipRefund: h.quoteScholarshipRefund,
  issueScholarshipRefund: h.issueScholarshipRefund,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      let slug: unknown = null
      const chain = {
        select: () => {
          h.reads.push(table)
          return chain
        },
        update: () => {
          h.writes.push(table)
          return chain
        },
        eq: (col: string, v: unknown) => {
          if (col === 'slug') slug = v
          return chain
        },
        maybeSingle: async () => {
          if (table === 'events') return h.events.get(String(slug)) ?? { data: null, error: null }
          if (table === 'scholarship_applications') return { data: h.appRow.current, error: null }
          if (table === 'registrations') return { data: h.regRow.current, error: null }
          return { data: null, error: null }
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      }
      return chain
    },
  }),
}))

const notes = await import('@/app/api/admin/scholarships/[id]/route')
const cancel = await import('@/app/api/admin/scholarships/[id]/cancel/route')
const notOffered = await import('@/app/api/admin/scholarships/[id]/not-offered/route')
const offer = await import('@/app/api/admin/scholarships/[id]/offer/route')
const refund = await import('@/app/api/admin/scholarships/[id]/refund/route')
const refundQuote = await import('@/app/api/admin/scholarships/[id]/refund-quote/route')
const resend = await import('@/app/api/admin/scholarships/[id]/resend/route')

const ctx = () => ({ params: Promise.resolve({ id: APP_ID }) })
const base = `https://www.stellreducation.org/api/admin/scholarships/${APP_ID}`
const json = (method: string, path: string, body?: unknown) =>
  new Request(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const OFFERED = {
  id: APP_ID,
  event_slug: 'colorado',
  tenant_id: STELLR_TENANT_ID,
  status: 'offered',
  registration_id: REG_ID,
  percent_off: 50,
  registration_paid_at_offer: true,
}

/** Every route, called the way the review panel calls it. */
const CALLS: [string, () => Promise<Response>, () => void][] = [
  ['PATCH notes', () => notes.PATCH(json('PATCH', '', { adminNotes: 'note' }), ctx()), () => expect(h.writes).toEqual([])],
  ['POST cancel', () => cancel.POST(json('POST', '/cancel', {}), ctx()), () => expect(h.cancelScholarship).not.toHaveBeenCalled()],
  ['POST not-offered', () => notOffered.POST(json('POST', '/not-offered'), ctx()), () => expect(h.markNotOffered).not.toHaveBeenCalled()],
  [
    'POST offer',
    () => offer.POST(json('POST', '/offer', { percent: 50, eventSlug: 'colorado' }), ctx()),
    () => expect(h.offerScholarship).not.toHaveBeenCalled(),
  ],
  ['POST refund', () => refund.POST(json('POST', '/refund', {}), ctx()), () => expect(h.issueScholarshipRefund).not.toHaveBeenCalled()],
  [
    'GET refund-quote',
    () => refundQuote.GET(new Request(`${base}/refund-quote?registrationId=${REG_ID}&percent=50`), ctx()),
    () => expect(h.quoteScholarshipRefund).not.toHaveBeenCalled(),
  ],
  ['POST resend', () => resend.POST(json('POST', '/resend'), ctx()), () => expect(h.sendScholarshipOfferEmails).not.toHaveBeenCalled()],
]

beforeEach(() => {
  vi.clearAllMocks()
  h.hasCapability.mockResolvedValue(true)
  h.appRow.current = { ...OFFERED }
  h.regRow.current = { id: REG_ID, event_slug: 'colorado', tenant_id: STELLR_TENANT_ID }
  h.events.clear()
  h.reads.length = 0
  h.writes.length = 0
})

describe("C20b: Stellr's applications answer as before", () => {
  it.each(CALLS)('%s: 200 for an application on a Stellr event', async (_label, call) => {
    h.events.set('colorado', { data: { tenant_id: STELLR_TENANT_ID }, error: null })
    const res = await call()
    expect(res.status).toBe(200)
  })

  it.each(CALLS)('%s: an unmirrored slug counts as Stellr', async (_label, call) => {
    expect((await call()).status).toBe(200)
  })

  it.each(CALLS)('%s: 403 without the capability, before the application is read', async (_label, call, nothingDone) => {
    h.hasCapability.mockResolvedValue(false)
    expect((await call()).status).toBe(403)
    expect(h.reads).toEqual([])
    nothingDone()
  })

  it('an application with no event yet (submitted) is Stellr\'s: notes save, not-offered closes it', async () => {
    h.appRow.current = { id: APP_ID, event_slug: null, tenant_id: null, status: 'submitted' }
    expect((await notes.PATCH(json('PATCH', '', { adminNotes: 'note' }), ctx())).status).toBe(200)
    expect(h.writes).toEqual(['scholarship_applications'])
    expect((await notOffered.POST(json('POST', '/not-offered'), ctx())).status).toBe(200)
    expect(h.reads).not.toContain('events')
  })

  it('offer passes the reviewer and the chosen event on unchanged', async () => {
    const res = await offer.POST(json('POST', '/offer', { percent: 50, eventSlug: 'colorado', sendEmails: false }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, registrationId: 'reg-new', emailedTo: ['a@example.com'], refund: null })
    expect(h.offerScholarship).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ applicationId: APP_ID, percent: 50, eventSlug: 'colorado', sendEmails: false, refundMethod: 'cash' }),
    )
  })

  it('refund keeps its 409 for an application with nothing to reimburse, and for a missing one', async () => {
    h.appRow.current = { ...OFFERED, registration_paid_at_offer: false }
    expect((await refund.POST(json('POST', '/refund', {}), ctx())).status).toBe(409)
    h.appRow.current = null
    expect((await refund.POST(json('POST', '/refund', {}), ctx())).status).toBe(409)
    expect(h.issueScholarshipRefund).not.toHaveBeenCalled()
  })

  it('refund-quote keeps "Registration not found" for a registration that is not there', async () => {
    h.regRow.current = null
    const res = await refundQuote.GET(new Request(`${base}/refund-quote?registrationId=${REG_ID}&percent=50`), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'manual', detail: 'Registration not found' })
    expect(h.quoteScholarshipRefund).not.toHaveBeenCalled()
  })
})

describe("C20b: another tenant's event is refused, for a Stellr admin too", () => {
  it.each(CALLS)('%s: the application on another tenant\'s event answers as a missing one', async (label, call, nothingDone) => {
    h.events.set('colorado', { data: { tenant_id: OTHER_TENANT }, error: null })
    const res = await call()
    // The refund route answers a missing application with its 409, and refund-quote checks
    // the application before the registration, so both end before Stripe.
    expect(res.status).toBe(label === 'POST refund' ? 409 : 404)
    expect(h.writes).toEqual([])
    nothingDone()
  })

  it.each(CALLS)('%s: an application stamped with another tenant answers as a missing one', async (label, call, nothingDone) => {
    h.appRow.current = { ...OFFERED, tenant_id: OTHER_TENANT }
    const res = await call()
    expect(res.status).toBe(label === 'POST refund' ? 409 : 404)
    expect(h.reads).not.toContain('events')
    nothingDone()
  })

  it.each(CALLS)('%s: a failed read of the event\'s owner is a retryable 503, never Stellr\'s', async (_label, call, nothingDone) => {
    h.events.set('colorado', { data: null, error: { code: '57014', message: 'statement timeout' } })
    const res = await call()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(h.writes).toEqual([])
    nothingDone()
  })

  it('offer onto another tenant\'s event is refused for a Stellr application, before anything is written or sent', async () => {
    h.appRow.current = { id: APP_ID, event_slug: null, tenant_id: STELLR_TENANT_ID, status: 'submitted' }
    h.events.set('nevada-tenant', { data: { tenant_id: OTHER_TENANT }, error: null })
    const res = await offer.POST(json('POST', '/offer', { percent: 50, eventSlug: 'nevada-tenant' }), ctx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Application not found' })
    expect(h.offerScholarship).not.toHaveBeenCalled()
  })

  it('refund-quote for a registration on another tenant\'s event answers as one not found, before Stripe', async () => {
    h.events.set('colorado', { data: { tenant_id: STELLR_TENANT_ID }, error: null })
    h.regRow.current = { id: REG_ID, event_slug: 'nevada-tenant', tenant_id: STELLR_TENANT_ID }
    h.events.set('nevada-tenant', { data: { tenant_id: OTHER_TENANT }, error: null })
    const res = await refundQuote.GET(new Request(`${base}/refund-quote?registrationId=${REG_ID}&percent=50`), ctx())
    expect(await res.json()).toMatchObject({ status: 'manual', detail: 'Registration not found' })
    expect(h.quoteScholarshipRefund).not.toHaveBeenCalled()

    h.regRow.current = { id: REG_ID, event_slug: 'colorado', tenant_id: OTHER_TENANT }
    const stamped = await refundQuote.GET(new Request(`${base}/refund-quote?registrationId=${REG_ID}&percent=50`), ctx())
    expect(await stamped.json()).toMatchObject({ status: 'manual', detail: 'Registration not found' })
    expect(h.quoteScholarshipRefund).not.toHaveBeenCalled()
  })
})
