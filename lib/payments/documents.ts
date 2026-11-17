import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

// What paid for one participant's place, and the documents that prove it.
//
// One answer for every surface that hands out a receipt or an invoice: the member's
// Billing tab, the event roster and the admin member page. Nothing here is stored;
// it is read from Stripe each time, as the receipt route always did:
//   1. participants.stripe_payment_intent_id  — the member's own place, paid by card
//   2. registrations.stripe_payment_intent_id — an individual registration, or a
//      group paid by card in one go
//   3. group_invoices (paid)                  — a group's Stripe invoice, paid online;
//      older invoices without a ledger row are found by Stripe search
// A paid Stripe invoice for a card payment is the one Checkout issued for it
// (lib/payments/checkout-invoice.ts), found by its checkout* metadata.
// An invoice an admin marked paid offline has no Stripe record: offlinePaid.

export const PARTICIPANT_DOC_COLUMNS =
  'id, registration_id, member_id, first_name, last_name, email, stripe_payment_intent_id'

export const REGISTRATION_DOC_COLUMNS =
  'id, type, status, event_slug, event_title, invoice_requested, invoice_paid_at, stripe_payment_intent_id, member_pays_individually, teacher_first_name, teacher_last_name, teacher_email, school_name, group_name, amount_due_cents, adult_count, student_count, tenant_id'

export interface ParticipantForDocs {
  id: string
  registration_id: string
  member_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  stripe_payment_intent_id: string | null
}

export interface RegistrationForDocs {
  id: string
  type: string | null
  status: string | null
  event_slug: string
  event_title: string | null
  invoice_requested: boolean | null
  invoice_paid_at: string | null
  stripe_payment_intent_id: string | null
  member_pays_individually: boolean | null
  teacher_first_name: string | null
  teacher_last_name: string | null
  teacher_email: string | null
  school_name: string | null
  group_name: string | null
  amount_due_cents: number | null
  adult_count: number | null
  student_count: number | null
  tenant_id?: string | null
}

export interface ChargeFacts {
  paymentIntentId: string
  chargeId: string
  receiptUrl: string | null
  amountCents: number
  refundedCents: number
  currency: string
  paidAt: string
  cardBrand: string | null
  cardLast4: string | null
  billingName: string | null
  billingEmail: string | null
}

export interface InvoiceFacts {
  id: string
  number: string | null
  pdfUrl: string | null
  hostedUrl: string | null
  amountPaidCents: number
  currency: string
  paidAt: string | null
  /** Places on the invoice, when it is a group's (group_invoices.seats). */
  seats: number | null
}

export interface PaymentDocuments {
  /** The card payment, when there is one. */
  charge: ChargeFacts | null
  /** A PAID Stripe invoice for this place (Checkout's, or the group's). */
  invoice: InvoiceFacts | null
  /** The group's invoice was marked paid by staff: no Stripe record exists. */
  offlinePaid: boolean
  /** Stripe's receipt page, else the paid invoice's PDF: what "Receipt" opens. */
  receiptUrl: string | null
}

type Db = SupabaseClient

const SAFE_ID = /^[A-Za-z0-9_-]+$/

/** A card payment's facts, from its PaymentIntent. Null when Stripe has no charge for it. */
export async function chargeFacts(stripe: Stripe, paymentIntentId: string): Promise<ChargeFacts | null> {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
    const charge = pi.latest_charge
    if (!charge || typeof charge === 'string' || !charge.paid) return null
    const card = charge.payment_method_details?.card
    return {
      paymentIntentId: pi.id,
      chargeId: charge.id,
      receiptUrl: charge.receipt_url ?? null,
      amountCents: charge.amount,
      refundedCents: charge.amount_refunded ?? 0,
      currency: charge.currency,
      paidAt: new Date(charge.created * 1000).toISOString(),
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null,
      billingName: charge.billing_details?.name ?? null,
      billingEmail: charge.billing_details?.email ?? charge.receipt_email ?? null,
    }
  } catch (err) {
    console.error('[payments/documents] PaymentIntent lookup failed:', err)
    return null
  }
}

function invoiceFacts(inv: Stripe.Invoice, seats: number | null = null): InvoiceFacts {
  const paidAt = inv.status_transitions?.paid_at
  return {
    id: inv.id ?? '',
    number: inv.number ?? null,
    pdfUrl: inv.invoice_pdf ?? null,
    hostedUrl: inv.hosted_invoice_url ?? null,
    amountPaidCents: inv.amount_paid ?? 0,
    currency: inv.currency,
    paidAt: paidAt ? new Date(paidAt * 1000).toISOString() : null,
    seats,
  }
}

/** The paid invoice Checkout issued for a card payment, if invoices were on when it was paid. */
async function checkoutInvoice(
  stripe: Stripe,
  key: 'checkoutParticipantId' | 'checkoutRegistrationId',
  id: string,
): Promise<InvoiceFacts | null> {
  if (!SAFE_ID.test(id)) return null
  try {
    const found = await stripe.invoices.search({ query: `metadata['${key}']:'${id}'`, limit: 10 })
    // A registration-level search must not pick up one member's own seat invoice.
    const paid = found.data.find(
      (inv) => inv.status === 'paid' && (key === 'checkoutParticipantId' || !inv.metadata?.checkoutParticipantId),
    )
    return paid ? invoiceFacts(paid) : null
  } catch (err) {
    console.error('[payments/documents] Checkout invoice search failed:', err)
    return null
  }
}

/**
 * The group's paid Stripe invoice that covers this participant: an "additional places"
 * invoice naming them, else the group's main invoice. Falls back to Stripe search for
 * invoices issued before the group_invoices ledger existed.
 */
async function groupInvoice(
  db: Db,
  stripe: Stripe,
  registrationId: string,
  participantId: string,
): Promise<{ invoice: InvoiceFacts; paymentIntentId: string | null } | null> {
  const { data: rows } = await db
    .from('group_invoices')
    .select('stripe_invoice_id, kind, seats, participant_ids, payment_intent_id, paid_at')
    .eq('registration_id', registrationId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
  type Row = { stripe_invoice_id: string; kind: string; seats: number; participant_ids: string[] | null; payment_intent_id: string | null }
  const ledger = (rows ?? []) as Row[]
  const row =
    ledger.find((r) => r.kind === 'additional' && (r.participant_ids ?? []).includes(participantId)) ??
    ledger.find((r) => r.kind === 'seats')
  if (row) {
    try {
      const inv = await stripe.invoices.retrieve(row.stripe_invoice_id)
      if (inv.status === 'paid') return { invoice: invoiceFacts(inv, row.seats), paymentIntentId: row.payment_intent_id }
    } catch (err) {
      console.error('[payments/documents] group invoice retrieve failed:', err)
    }
  }
  if (!SAFE_ID.test(registrationId)) return null
  try {
    const found = await stripe.invoices.search({ query: `metadata['registrationId']:'${registrationId}'`, limit: 10 })
    const paid = found.data.find((inv) => inv.status === 'paid')
    return paid ? { invoice: invoiceFacts(paid), paymentIntentId: null } : null
  } catch (err) {
    console.error('[payments/documents] invoice search failed:', err)
    return null
  }
}

export async function resolvePaymentDocuments(
  db: Db,
  stripe: Stripe,
  participant: ParticipantForDocs,
  registration: RegistrationForDocs,
): Promise<PaymentDocuments> {
  let charge: ChargeFacts | null = null
  let invoice: InvoiceFacts | null = null

  if (participant.stripe_payment_intent_id) {
    charge = await chargeFacts(stripe, participant.stripe_payment_intent_id)
    if (charge) invoice = await checkoutInvoice(stripe, 'checkoutParticipantId', participant.id)
  }
  if (!charge && registration.stripe_payment_intent_id) {
    charge = await chargeFacts(stripe, registration.stripe_payment_intent_id)
    if (charge) invoice = await checkoutInvoice(stripe, 'checkoutRegistrationId', registration.id)
  }
  // Invoiced registrations have documents once the invoice is settled.
  if (!charge && registration.invoice_requested && registration.invoice_paid_at) {
    const group = await groupInvoice(db, stripe, registration.id, participant.id)
    if (group) {
      invoice = group.invoice
      if (group.paymentIntentId) charge = await chargeFacts(stripe, group.paymentIntentId)
    }
  }

  const offlinePaid = !charge && !invoice && !!registration.invoice_requested && !!registration.invoice_paid_at
  return {
    charge,
    invoice,
    offlinePaid,
    receiptUrl: charge?.receiptUrl ?? invoice?.pdfUrl ?? invoice?.hostedUrl ?? null,
  }
}

/** Was anything paid for this place (so a receipt or invoice can exist)? */
export function hasPaidDocuments(docs: PaymentDocuments): boolean {
  return !!docs.charge || !!docs.invoice || docs.offlinePaid
}
