import type Stripe from 'stripe'

// Paid invoices and emailed receipts for card payments made through Stripe Checkout.
//
// Before this, a card payment left only a Stripe charge: no invoice, and no receipt
// email unless the dashboard happened to send one. A teacher who paid her own place
// by pay link on 9 Nov 2026 needed both for her school's reimbursement, and neither
// existed. With invoice_creation on, Checkout issues a PAID invoice for every
// payment, which Stripe emails with its receipt, and the Billing tab and the roster
// can hand out its PDF.
//
// Cost: Stripe charges a per-invoice fee for an invoice Checkout creates after
// payment (Invoicing pricing). Set CHECKOUT_INVOICES_ENABLED to false to stop
// issuing them; the receipt email (payment_intent_data.receipt_email) stays on, and
// people can still download our own paid-invoice PDF (lib/payments/paid-invoice-pdf.ts).
export const CHECKOUT_INVOICES_ENABLED = true

// The marker on every invoice Checkout issues for us. The invoice.paid webhook treats
// an invoice carrying metadata.registrationId as a GROUP invoice (recordGroupInvoicePaid
// then confirmRegistration), so a Checkout invoice must never carry that key: it uses
// checkoutRegistrationId / checkoutParticipantId instead, and source = 'checkout' so the
// webhook can skip it outright (the checkout.session.completed handler already settled
// the payment it records).
export const CHECKOUT_INVOICE_SOURCE = 'checkout'

export interface CheckoutInvoiceInput {
  registrationId: string
  eventSlug: string
  eventTitle?: string | null
  /** A seat checkout: the participant whose place this pays for. */
  participantId?: string | null
  /** Who the place is for, for the invoice description. */
  forName?: string | null
  /** Where Stripe emails the receipt. Leave out when the payer types their own address. */
  receiptEmail?: string | null
}

/** The invoice and receipt settings a Checkout Session for an event payment carries. */
export function checkoutInvoiceParams(
  input: CheckoutInvoiceInput,
): Pick<Stripe.Checkout.SessionCreateParams, 'invoice_creation' | 'payment_intent_data'> {
  const event = (input.eventTitle ?? '').trim() || input.eventSlug
  const forName = (input.forName ?? '').trim()
  const description = forName ? `${event}: registration for ${forName}` : `${event}: registration`
  const metadata: Record<string, string> = {
    source: CHECKOUT_INVOICE_SOURCE,
    checkoutRegistrationId: input.registrationId,
    eventSlug: input.eventSlug,
  }
  if (input.participantId) metadata.checkoutParticipantId = input.participantId

  const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
    description: description.slice(0, 1000),
    ...(input.receiptEmail ? { receipt_email: input.receiptEmail } : {}),
  }

  return {
    payment_intent_data: paymentIntentData,
    ...(CHECKOUT_INVOICES_ENABLED
      ? {
          invoice_creation: {
            enabled: true,
            invoice_data: {
              description: description.slice(0, 1500),
              metadata,
              footer: 'Paid in full. Thank you for registering with Stellr Education.',
            },
          },
        }
      : {}),
  }
}

/** Is this an invoice Checkout issued for an event payment (not a group or membership invoice)? */
export function isCheckoutInvoice(invoice: Pick<Stripe.Invoice, 'metadata'>): boolean {
  return invoice.metadata?.source === CHECKOUT_INVOICE_SOURCE
}
