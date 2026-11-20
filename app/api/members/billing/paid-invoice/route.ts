import { auth } from '@clerk/nextjs/server'
import { NextRequest } from 'next/server'
import { stripeClient } from '@/lib/stripe'
import { htmlMessage, loadMemberPlace } from '@/lib/payments/member-access'
import { paidInvoiceFor, paidInvoiceResponse } from '@/lib/payments/paid-invoice-response'

// GET /api/members/billing/paid-invoice?participation=<participant_id>
// The Billing tab's "Invoice" link for a paid place: Stripe's paid invoice PDF when
// there is one, else a paid invoice Stellr issues from the payment record (a card
// payment made before Checkout issued invoices, or an invoice marked paid offline).
// Same scoping as the receipt link: the member's own place, or view-as.

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  const place = await loadMemberPlace(userId, req.nextUrl.searchParams.get('participation'))
  if (!place.ok) return place.response

  const out = await paidInvoiceFor(place.db, stripeClient(), place.participant, place.registration)
  return paidInvoiceResponse(out, () =>
    htmlMessage('No payment has been recorded for this place yet, so there is no paid invoice to download.', 404),
  )
}
