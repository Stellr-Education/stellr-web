// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

// Crew download a place's paid invoice (and, in ../receipt, its receipt) on someone's
// behalf. Who may: admins, Staff (both reach requireEventCrew with every event), and an
// event's managers for their own events only. The participant must be on the URL's
// registration. The loaders in lib/tenancy/load-scoped.ts are real, over a fake database;
// the document lookup is a stand-in.

const ID = '22222222-2222-4222-8222-222222222222'
const PID = '33333333-3333-4333-8333-333333333333'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  requireEventCrew: vi.fn(),
  registration: null as Record<string, unknown> | null,
  participant: null as Record<string, unknown> | null,
  participantFilter: {} as Record<string, unknown>,
  events: {} as Record<string, string | null>,
  paidInvoiceFor: vi.fn(),
  resolve: vi.fn(),
  audits: [] as unknown[],
}))

function fakeDb() {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (col: string, value: unknown) => {
      filters[col] = value
      return chain
    }
    for (const m of ['or', 'in', 'is', 'not', 'limit', 'order']) chain[m] = () => chain
    chain.maybeSingle = async () => {
      if (table === 'events') {
        const s = String(filters.slug)
        return { data: s in h.events ? { slug: s, tenant_id: h.events[s] } : null, error: null }
      }
      if (table === 'registrations') return { data: h.registration, error: null }
      if (table === 'participants') {
        h.participantFilter = { ...filters }
        const p = h.participant
        const match = p && p.id === filters.id && p.registration_id === filters.registration_id
        return { data: match ? p : null, error: null }
      }
      return { data: null, error: null }
    }
    return chain
  }
  return { from }
}

vi.mock('@/lib/authz', () => ({ requireEventCrew: (...a: unknown[]) => h.requireEventCrew(...a) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => fakeDb() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({}) }))
vi.mock('@/lib/payments/paid-invoice-response', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  paidInvoiceFor: h.paidInvoiceFor,
}))
vi.mock('@/lib/payments/documents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolvePaymentDocuments: h.resolve,
}))
vi.mock('@/lib/audit/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  audit: async (input: unknown) => {
    h.audits.push(input)
    return { ok: true, id: 1, seq: 1 }
  },
}))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: (_l: string, task: () => Promise<unknown>) => { void task() } }))

const { GET } = await import('./route')
const { GET: GET_RECEIPT } = await import('../receipt/route')

const ctx = () => ({ params: Promise.resolve({ id: ID }) })
const get = (pid: string | null = PID) =>
  GET(new Request(`https://app.test/api/admin/registrations/${ID}/paid-invoice${pid ? `?participant=${pid}` : ''}`), ctx())
const getReceipt = (pid: string = PID) =>
  GET_RECEIPT(new Request(`https://app.test/api/admin/registrations/${ID}/receipt?participant=${pid}`), ctx())

function crew(opts: { tenantId?: string; assigned?: string[] | null } = {}) {
  const tenantId = opts.tenantId ?? STELLR_TENANT_ID
  const assigned = opts.assigned ?? null
  return {
    ok: true as const,
    userId: 'user_crew',
    isAdmin: assigned === null,
    tenantId,
    scope: tenantWideScope(tenantId, assigned === null ? 'tenant_admin' : 'crew'),
    covers: (slug: string | null | undefined) => assigned === null || (!!slug && assigned.includes(slug)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.audits = []
  h.events = {}
  h.registration = { id: ID, event_slug: 'msu', type: 'group', tenant_id: null }
  h.participant = { id: PID, registration_id: ID, first_name: 'Pat', last_name: 'Teacher', stripe_payment_intent_id: 'pi_1' }
  h.paidInvoiceFor.mockResolvedValue({ kind: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]), filename: 'Stellr-paid-invoice-STL-X.pdf', documentNumber: 'STL-X' })
  h.resolve.mockResolvedValue({ charge: null, invoice: null, offlinePaid: false, receiptUrl: 'https://pay.stripe.com/receipts/x' })
})

describe('GET paid-invoice: who may download', () => {
  it('an admin (or Staff, who reach every event) gets the PDF', async () => {
    h.requireEventCrew.mockResolvedValue(crew())
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('Stellr-paid-invoice-STL-X.pdf')
  })

  it("an event manager gets it for an event they manage", async () => {
    h.requireEventCrew.mockResolvedValue(crew({ assigned: ['msu'] }))
    expect((await get()).status).toBe(200)
  })

  it("an event manager gets 404 for someone else's event, and nothing is generated", async () => {
    h.requireEventCrew.mockResolvedValue(crew({ assigned: ['nevada'] }))
    expect((await get()).status).toBe(404)
    expect(h.paidInvoiceFor).not.toHaveBeenCalled()
  })

  it('anyone else is refused before any record is read', async () => {
    h.requireEventCrew.mockResolvedValue({ ok: false, status: 403 })
    expect((await get()).status).toBe(403)
    expect(h.paidInvoiceFor).not.toHaveBeenCalled()
  })

  it('a participant on another registration answers as missing', async () => {
    h.requireEventCrew.mockResolvedValue(crew())
    h.participant = { id: PID, registration_id: 'another-registration' }
    expect((await get()).status).toBe(404)
    expect(h.participantFilter.registration_id).toBe(ID)
  })

  it("another tenant's registration answers as missing", async () => {
    h.requireEventCrew.mockResolvedValue(crew())
    h.registration = { id: ID, event_slug: 'msu', type: 'group', tenant_id: OTHER_TENANT }
    expect((await get()).status).toBe(404)
  })

  it('needs a participant', async () => {
    h.requireEventCrew.mockResolvedValue(crew())
    expect((await get(null)).status).toBe(400)
  })

  it('redirects to Stripe when Stripe holds the paid invoice', async () => {
    h.requireEventCrew.mockResolvedValue(crew())
    h.paidInvoiceFor.mockResolvedValue({ kind: 'stripe', url: 'https://pay.stripe.com/invoice/x/pdf' })
    const res = await get()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://pay.stripe.com/invoice/x/pdf')
  })

  it('404s when nothing was paid', async () => {
    h.requireEventCrew.mockResolvedValue(crew())
    h.paidInvoiceFor.mockResolvedValue({ kind: 'none', offlinePaid: false })
    expect((await get()).status).toBe(404)
  })
})

describe('GET receipt', () => {
  it('redirects crew to the Stripe receipt', async () => {
    h.requireEventCrew.mockResolvedValue(crew({ assigned: ['msu'] }))
    const res = await getReceipt()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://pay.stripe.com/receipts/x')
  })

  it("is refused for an event the manager doesn't cover", async () => {
    h.requireEventCrew.mockResolvedValue(crew({ assigned: ['nevada'] }))
    expect((await getReceipt()).status).toBe(404)
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('points to Invoice when the invoice was paid offline', async () => {
    h.requireEventCrew.mockResolvedValue(crew())
    h.resolve.mockResolvedValue({ charge: null, invoice: null, offlinePaid: true, receiptUrl: null })
    const res = await getReceipt()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('Invoice')
  })
})
