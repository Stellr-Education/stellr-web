// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildPaidInvoiceData, renderPaidInvoicePdf } from './paid-invoice-pdf'
import type { ParticipantForDocs, PaymentDocuments, RegistrationForDocs } from './documents'

const participant: ParticipantForDocs = {
  id: 'p-1', registration_id: 'r-1', member_id: 'm-1', first_name: 'Pat', last_name: 'Lé', email: 'a@example.test',
  stripe_payment_intent_id: 'pi_seat',
}
const registration: RegistrationForDocs = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', type: 'group', status: 'confirmed', event_slug: 'msu',
  event_title: 'Minnesota Environmental Design Challenge', invoice_requested: false, invoice_paid_at: null,
  stripe_payment_intent_id: null, member_pays_individually: true, teacher_first_name: 'Teach', teacher_last_name: 'Er',
  teacher_email: 't@example.test', school_name: 'Lake Benton School', group_name: null, amount_due_cents: 40000,
  adult_count: 1, student_count: 4,
}
const card: PaymentDocuments = {
  charge: {
    paymentIntentId: 'pi_seat', chargeId: 'ch_3UZxXiFHHVJXH5Ab0mJcbgbW', receiptUrl: 'https://r', amountCents: 8245,
    refundedCents: 0, currency: 'usd', paidAt: '2026-11-09T17:23:47Z', cardBrand: 'visa', cardLast4: '8046',
    billingName: 'Pat Lé', billingEmail: 'a@example.test',
  },
  invoice: null, offlinePaid: false, receiptUrl: 'https://r',
}

function db(groupInvoices: Record<string, unknown>[] = [], refunds: Record<string, unknown>[] = []) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain
      chain.then = (res: (v: unknown) => void) => res({ data: table === 'group_invoices' ? groupInvoices : refunds, error: null })
      return chain
    },
  } as never
}

describe('buildPaidInvoiceData', () => {
  it("a member's own card payment is billed to them, for one place", async () => {
    const d = await buildPaidInvoiceData(db(), card, participant, registration, new Date('2026-11-17T12:00:00Z'))
    expect(d).toMatchObject({
      documentNumber: 'STL-AB0MJCBGBW',
      payerName: 'Pat Lé',
      totalCents: 8245,
      method: 'Visa card ending 8046',
      lines: [{ quantity: 1, amountCents: 8245, description: 'Minnesota Environmental Design Challenge: registration for Pat Lé' }],
    })
  })

  it('an invoice marked paid offline uses the group ledger and its cash refunds', async () => {
    const offline: PaymentDocuments = { charge: null, invoice: null, offlinePaid: true, receiptUrl: null }
    const reg = { ...registration, invoice_requested: true, invoice_paid_at: '2026-11-02T00:00:00Z' }
    const d = await buildPaidInvoiceData(db([{ total_cents: 40000, seats: 5, stripe_invoice_number: 'INV-7' }], [{ refund_cents: 8000 }]), offline, participant, reg)
    expect(d).toMatchObject({ payerName: 'Teach Er', totalCents: 40000, refundedCents: 8000, reference: 'Invoice INV-7' })
    expect(d?.lines[0].quantity).toBe(5)
    expect(d?.documentNumber).toBe('STL-AAAAAAAABB')
  })

  it('nothing paid: no invoice', async () => {
    expect(await buildPaidInvoiceData(db(), { charge: null, invoice: null, offlinePaid: false, receiptUrl: null }, participant, registration)).toBeNull()
  })
})

describe('renderPaidInvoicePdf', () => {
  it('renders a one-page PDF, accented names and all', async () => {
    const d = await buildPaidInvoiceData(db(), { ...card, charge: { ...card.charge!, refundedCents: 2000 } }, participant, registration)
    const bytes = await renderPaidInvoicePdf(d!)
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe('%PDF')
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getTitle()).toContain('Paid invoice STL-')
  })
})
