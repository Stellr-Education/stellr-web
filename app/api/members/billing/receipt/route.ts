import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { stripeClient } from '@/lib/stripe'
import { resolvePaymentDocuments } from '@/lib/payments/documents'
import { htmlMessage, loadMemberPlace } from '@/lib/payments/member-access'

// GET /api/members/billing/receipt?participation=<participant_id>
// Redirects to the Stripe receipt for a place the member was paid into: the card
// payment's receipt page, else a paid Stripe invoice's PDF (lib/payments/documents.ts).
// Plain-anchor friendly: 302 on success, small HTML message otherwise. An invoice
// marked paid offline has no Stripe receipt; the Billing tab's Invoice link
// (/api/members/billing/paid-invoice) issues Stellr's own paid invoice for it.

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  const place = await loadMemberPlace(userId, req.nextUrl.searchParams.get('participation'))
  if (!place.ok) return place.response

  const stripe = stripeClient()
  if (!stripe) return htmlMessage('Payments are not configured.', 503)

  const docs = await resolvePaymentDocuments(place.db, stripe, place.participant, place.registration)
  if (!docs.receiptUrl) {
    return htmlMessage(
      docs.offlinePaid
        ? 'This invoice was recorded as paid. Use the Invoice link in your Billing tab for a paid invoice you can keep.'
        : 'No receipt is available for this payment yet. If the payment was recent, please check back shortly.',
      404,
    )
  }
  return NextResponse.redirect(docs.receiptUrl, 302)
}
