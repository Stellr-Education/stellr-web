import { NextResponse } from 'next/server'
import { requireEventCrew } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { notFound, placeOnRegistration } from '@/lib/payments/crew-access'
import { REGISTRATION_DOC_COLUMNS, type RegistrationForDocs } from '@/lib/payments/documents'
import { loadEventRecord } from '@/lib/tenancy/load-scoped'
import { paidInvoiceFor, paidInvoiceResponse } from '@/lib/payments/paid-invoice-response'

// GET /api/admin/registrations/[id]/paid-invoice?participant=<participant_id>
// The paid invoice for a place, for crew to download and pass on: admins, Staff,
// and the event's managers for their own events. Stripe's paid invoice PDF when
// there is one, else a paid invoice Stellr issues from the payment record
// (lib/payments/paid-invoice-pdf.ts).

const ROUTE = '/api/admin/registrations/[id]/paid-invoice'

type Args = [Request, { params: Promise<{ id: string }> }]

export const GET = withAudit(
  ({ args: [req] }: { args: Args }) => ({ action: 'registration.paid_invoice.read', ...auditSubject(req, 'participants') }),
  readPaidInvoice,
)

async function readPaidInvoice(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const out = await paidInvoiceFor(db, stripeClient(), place.participant, place.registration)
  if (out.kind === 'pdf') noteAuditSubject(req, { detail: { document_number: out.documentNumber } })
  return paidInvoiceResponse(out, () => NextResponse.json({ error: 'No payment found for this place' }, { status: 404 }))
}
