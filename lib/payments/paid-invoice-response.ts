import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { resolvePaymentDocuments, type ParticipantForDocs, type RegistrationForDocs } from './documents'
import { buildPaidInvoiceData, renderPaidInvoicePdf } from './paid-invoice-pdf'

export type PaidInvoiceOutcome =
  | { kind: 'stripe'; url: string }
  | { kind: 'pdf'; filename: string; bytes: Uint8Array; documentNumber: string }
  | { kind: 'none'; offlinePaid: boolean }

/**
 * The "Invoice" for a paid place: Stripe's own paid invoice PDF when one exists (Checkout's,
 * or the group's), else a paid invoice Stellr issues from the payment record. 'none' when
 * nothing was paid for the place.
 */
export async function paidInvoiceFor(
  db: SupabaseClient,
  stripe: Stripe | null,
  participant: ParticipantForDocs,
  registration: RegistrationForDocs,
): Promise<PaidInvoiceOutcome> {
  const docs = stripe
    ? await resolvePaymentDocuments(db, stripe, participant, registration)
    : {
        charge: null,
        invoice: null,
        offlinePaid: !!registration.invoice_requested && !!registration.invoice_paid_at,
        receiptUrl: null,
      }
  const stripeUrl = docs.invoice?.pdfUrl ?? docs.invoice?.hostedUrl
  if (stripeUrl) return { kind: 'stripe', url: stripeUrl }
  const data = await buildPaidInvoiceData(db, docs, participant, registration)
  if (!data) return { kind: 'none', offlinePaid: docs.offlinePaid }
  const bytes = await renderPaidInvoicePdf(data)
  return { kind: 'pdf', bytes, documentNumber: data.documentNumber, filename: `Stellr-paid-invoice-${data.documentNumber}.pdf` }
}

/** The outcome as a response: a redirect to Stripe, the PDF, or `none`'s answer. */
export function paidInvoiceResponse(out: PaidInvoiceOutcome, none: () => Response): Response {
  if (out.kind === 'stripe') return NextResponse.redirect(out.url, 302)
  if (out.kind === 'none') return none()
  return new NextResponse(Buffer.from(out.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
