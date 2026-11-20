import { describe, it, expect, vi } from 'vitest'
import type Stripe from 'stripe'
import { resolvePaymentDocuments, type ParticipantForDocs, type RegistrationForDocs } from './documents'
import { checkoutInvoiceParams, isCheckoutInvoice, CHECKOUT_INVOICES_ENABLED } from './checkout-invoice'

const PID = 'p-1'
const RID = 'r-1'

const participant = (over: Partial<ParticipantForDocs> = {}): ParticipantForDocs => ({
  id: PID, registration_id: RID, member_id: 'm-1', first_name: 'Ada', last_name: 'L', email: 'ada@example.test',
  stripe_payment_intent_id: null, ...over,
})
const registration = (over: Partial<RegistrationForDocs> = {}): RegistrationForDocs => ({
  id: RID, type: 'individual', status: 'confirmed', event_slug: 'msu', event_title: 'MN Challenge',
  invoice_requested: false, invoice_paid_at: null, stripe_payment_intent_id: null, member_pays_individually: false,
  teacher_first_name: null, teacher_last_name: null, teacher_email: null, school_name: null, group_name: null,
  amount_due_cents: null, adult_count: null, student_count: null, ...over,
})

function charge(id: string, over: Record<string, unknown> = {}) {
  return {
    id, paid: true, amount: 8245, amount_refunded: 0, currency: 'usd', created: 1794249827,
    receipt_url: `https://pay.stripe.com/receipts/${id}`, receipt_email: null,
    billing_details: { name: 'Ada L', email: 'ada@example.test' },
    payment_method_details: { card: { brand: 'visa', last4: '8046' } }, ...over,
  }
}

function fakeStripe(opts: {
  pis?: Record<string, ReturnType<typeof charge> | null>
  search?: (query: string) => Partial<Stripe.Invoice>[]
  invoices?: Record<string, Partial<Stripe.Invoice>>
}) {
  const search = vi.fn(async ({ query }: { query: string }) => ({ data: opts.search?.(query) ?? [] }))
  return {
    search,
    stripe: {
      paymentIntents: {
        retrieve: vi.fn(async (id: string) => ({ id, latest_charge: opts.pis?.[id] ?? null })),
      },
      invoices: {
        search,
        retrieve: vi.fn(async (id: string) => opts.invoices?.[id] ?? { id, status: 'open' }),
      },
    } as unknown as Stripe,
  }
}

function fakeDb(groupInvoices: Record<string, unknown>[] = []) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain
  chain.then = (res: (v: unknown) => void) => res({ data: groupInvoices, error: null })
  return { from: () => chain } as never
}

describe('resolvePaymentDocuments', () => {
  it("a member's own seat: its charge receipt and the Checkout invoice found by participant", async () => {
    const { stripe, search } = fakeStripe({
      pis: { pi_seat: charge('ch_seat') },
      search: (q) => (q.includes(`checkoutParticipantId']:'${PID}'`)
        ? [{ id: 'in_1', status: 'paid', number: 'A-1', invoice_pdf: 'https://pdf/in_1', amount_paid: 8245, currency: 'usd', metadata: {} }]
        : []),
    })
    const docs = await resolvePaymentDocuments(fakeDb(), stripe, participant({ stripe_payment_intent_id: 'pi_seat' }), registration())
    expect(docs.receiptUrl).toBe('https://pay.stripe.com/receipts/ch_seat')
    expect(docs.charge?.cardLast4).toBe('8046')
    expect(docs.invoice?.pdfUrl).toBe('https://pdf/in_1')
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('a pre-invoice card payment has a receipt and no invoice', async () => {
    const { stripe } = fakeStripe({ pis: { pi_old: charge('ch_old') } })
    const docs = await resolvePaymentDocuments(fakeDb(), stripe, participant({ stripe_payment_intent_id: 'pi_old' }), registration())
    expect(docs.invoice).toBeNull()
    expect(docs.receiptUrl).toContain('ch_old')
    expect(docs.offlinePaid).toBe(false)
  })

  it("a registration-level search skips one member's own seat invoice", async () => {
    const { stripe } = fakeStripe({
      pis: { pi_reg: charge('ch_reg') },
      search: () => [{ id: 'in_seat', status: 'paid', metadata: { checkoutParticipantId: 'p-9' } }],
    })
    const docs = await resolvePaymentDocuments(fakeDb(), stripe, participant(), registration({ stripe_payment_intent_id: 'pi_reg' }))
    expect(docs.invoice).toBeNull()
    expect(docs.receiptUrl).toContain('ch_reg')
  })

  it("a group's invoice paid online: the ledger's paid invoice and its payment's receipt", async () => {
    const { stripe } = fakeStripe({
      pis: { pi_inv: charge('ch_inv') },
      invoices: { in_g: { id: 'in_g', status: 'paid', invoice_pdf: 'https://pdf/in_g', amount_paid: 40000, currency: 'usd' } },
    })
    const db = fakeDb([{ stripe_invoice_id: 'in_g', kind: 'seats', seats: 5, participant_ids: [], payment_intent_id: 'pi_inv' }])
    const docs = await resolvePaymentDocuments(db, stripe, participant(), registration({ type: 'group', invoice_requested: true, invoice_paid_at: '2026-11-01T00:00:00Z' }))
    expect(docs.invoice?.pdfUrl).toBe('https://pdf/in_g')
    expect(docs.invoice?.seats).toBe(5)
    expect(docs.receiptUrl).toContain('ch_inv')
  })

  it('an invoice marked paid offline has no Stripe documents', async () => {
    const { stripe } = fakeStripe({})
    const docs = await resolvePaymentDocuments(fakeDb(), stripe, participant(), registration({ type: 'group', invoice_requested: true, invoice_paid_at: '2026-11-01T00:00:00Z' }))
    expect(docs).toEqual({ charge: null, invoice: null, offlinePaid: true, receiptUrl: null })
  })

  it('nothing paid yet: nothing at all', async () => {
    const { stripe } = fakeStripe({})
    const docs = await resolvePaymentDocuments(fakeDb(), stripe, participant(), registration())
    expect(docs).toEqual({ charge: null, invoice: null, offlinePaid: false, receiptUrl: null })
  })
})

describe('checkoutInvoiceParams', () => {
  it('never carries the group-invoice key, and marks itself as Checkout', () => {
    const p = checkoutInvoiceParams({ registrationId: RID, eventSlug: 'msu', eventTitle: 'MN Challenge', participantId: PID, forName: 'Ada L', receiptEmail: 'ada@example.test' })
    expect(p.payment_intent_data?.receipt_email).toBe('ada@example.test')
    expect(p.payment_intent_data?.description).toBe('MN Challenge: registration for Ada L')
    if (CHECKOUT_INVOICES_ENABLED) {
      const meta = p.invoice_creation?.invoice_data?.metadata as Record<string, string>
      expect(meta).toEqual({ source: 'checkout', checkoutRegistrationId: RID, checkoutParticipantId: PID, eventSlug: 'msu' })
      expect(meta).not.toHaveProperty('registrationId')
      expect(isCheckoutInvoice({ metadata: meta } as never)).toBe(true)
    }
  })

  it('leaves receipt_email out when the payer types their own address', () => {
    const p = checkoutInvoiceParams({ registrationId: RID, eventSlug: 'msu' })
    expect(p.payment_intent_data).not.toHaveProperty('receipt_email')
  })

  it('a group invoice is not a Checkout invoice', () => {
    expect(isCheckoutInvoice({ metadata: { registrationId: RID, isGroup: 'true' } } as never)).toBe(false)
  })
})
