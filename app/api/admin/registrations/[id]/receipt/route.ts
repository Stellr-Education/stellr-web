import { NextResponse } from 'next/server'
import { requireEventCrew } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { notFound, placeOnRegistration } from '@/lib/payments/crew-access'
import { REGISTRATION_DOC_COLUMNS, resolvePaymentDocuments, type RegistrationForDocs } from '@/lib/payments/documents'
import { loadEventRecord } from '@/lib/tenancy/load-scoped'

// GET /api/admin/registrations/[id]/receipt?participant=<participant_id>
// The Stripe receipt for a paid place, for crew to download and pass on: admins,
// Staff, and the event's managers for their own events. Redirects to Stripe's
// receipt page, else the paid Stripe invoice's PDF (lib/payments/documents.ts).
// An invoice marked paid offline has none: the roster's Invoice link issues one.

const ROUTE = '/api/admin/registrations/[id]/receipt'

type Args = [Request, { params: Promise<{ id: string }> }]

export const GET = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'registration.receipt.read', ...auditSubject(req, 'participants') }),
  readReceipt,
)

async function readReceipt(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })
  const participantId = new URL(req.url).searchParams.get('participant')
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, id: participantId, detail: { registration_id: id } })

  if (!participantId) return NextResponse.json({ error: 'participant is required' }, { status: 400 })

  const db = supabaseServer()
  const loaded = await loadEventRecord<RegistrationForDocs>(crew, 'registrations', id, {
    db,
    select: REGISTRATION_DOC_COLUMNS,
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const place = await placeOnRegistration(crew, db, loaded.row, participantId, ROUTE)
  if (!place.ok) return place.response
  noteAuditSubject(req, { eventSlug: place.registration.event_slug })

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
  const docs = await resolvePaymentDocuments(db, stripe, place.participant, place.registration)
  if (!docs.receiptUrl) {
    return NextResponse.json(
      { error: docs.offlinePaid ? 'This invoice was marked paid offline, so Stripe has no receipt. Use Invoice instead.' : 'No payment found for this place' },
      { status: 404 },
    )
  }
  return NextResponse.redirect(docs.receiptUrl, 302)
}
