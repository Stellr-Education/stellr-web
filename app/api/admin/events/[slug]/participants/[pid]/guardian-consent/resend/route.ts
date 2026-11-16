import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { loadRecord } from '@/lib/tenancy/load-scoped'
import { HOUR_MS } from '@/lib/rate-limit'
import { limit as limitRequests } from '@/lib/rate-limit-async'
import { remindEnvelopeRow } from '@/lib/esign/operations'
import { sendTenantSigningInvitation, TENANT_SIGNING_FAILED } from '@/lib/event-emails/tenant-signing'
import { TENANT_SENDER_REQUIRED, TenantSenderRequiredError } from '@/lib/event-emails/tenant-mail'
import {
  GUARDIAN_INVITES_PER_TENANT_PER_HOUR,
  pendingConsentForParticipant,
} from '@/lib/registration/tenant-guardian-consent'

// POST /api/admin/events/[slug]/participants/[pid]/guardian-consent/resend
//
// S5 wave 8 CONSENT (c), tracker T-23 / s5-programme.23: staff resend a guardian's
// consent form for a 14-17-year-old waiting on it at another organiser's event.
// Admins and the event's crew (requireEventRoute). No body.
//
// The form goes to the guardian already saved on the consent envelope, never to an
// address from the request. If the guardian's invitation never went (a refused or
// failed send at registration), it is sent now through B14's checked call
// (lib/event-emails/tenant-signing.ts), from the organiser's sender. If it went, the
// guardian is sent a reminder on the same envelope, which keeps the same form and
// renews the link (lib/esign/operations.ts remindEnvelopeRow). Either way the mail is
// the organiser's: without a usable sender nothing is sent.
//
// Only a pending consent on another organiser's event: Stellr's events have no
// consent rows, so for them this answers 404 and reads nothing more.
//
// Capped per consent and per organiser before anything is sent: the checked call's
// contract asks for both, and the per-organiser cap is the one the register route's
// invitations already count against, so a resend never adds to the hour's budget.

const ROUTE = '/api/admin/events/[slug]/participants/[pid]/guardian-consent/resend'

/** Resends one consent's form may have in a day. A proposal for the owner. */
const CONSENT_RESENDS_PER_DAY = 3

/** Copy for the desk and the roster. Proposals for the owner (WD-6 covers only the marker). */
const RESEND_MESSAGES = {
  none: 'No guardian consent is waiting for this participant.',
  unissued: 'No consent form was issued for this participant, so there is nothing to resend.',
  closed: 'The consent form is no longer out for signing.',
  mailOff: "Email for this organiser's events is turned off, so the form cannot be sent.",
  busy: 'The consent form was sent recently. Try again later.',
} as const

type Ctx = { params: Promise<{ slug: string; pid: string }> }

type Participant = {
  id: string
  registration_id: string
  registrations: { event_slug: string } | { event_slug: string }[]
}

type Envelope = { envelope_id: string; provider: string | null }

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'registration.guardian_consent.resend', ...auditSubject(req, 'participants') }),
  resendGuardianConsent,
)

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status })

async function resendGuardianConsent(req: Request, { params }: Ctx) {
  const { slug, pid } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id: pid })

  const db = supabaseServer()
  const notFound = () => json(404, { error: 'Participant not found for this event' })
  const loaded = await loadRecord<Participant>(crew.scope, 'participants', pid, {
    db,
    select: 'id, registration_id, registrations!inner(event_slug)',
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const p = loaded.row
  const reg = Array.isArray(p.registrations) ? p.registrations[0] : p.registrations
  if (reg?.event_slug !== slug) return notFound()

  let consent
  try {
    consent = await pendingConsentForParticipant(db, pid)
  } catch (err) {
    console.error('[admin/guardian-consent] consent read failed:', err instanceof Error ? err.message : err)
    return json(500, { error: 'Database error' })
  }
  // The consent must be for this registration: a row left from an earlier one is not.
  if (!consent || consent.registration_id !== p.registration_id) return json(404, { code: 'no_pending_consent', error: RESEND_MESSAGES.none })
  if (!consent.agreement_id) return json(409, { code: 'consent_not_issued', error: RESEND_MESSAGES.unissued })
  noteAuditSubject(req, { detail: { consent_id: consent.id, event_tenant_id: consent.tenant_id } })

  const busy = (retryAfterSeconds: number) =>
    NextResponse.json(
      { code: 'guardian_consent_busy', error: RESEND_MESSAGES.busy },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    )
  const perConsent = await limitRequests(`tenant-guardian-consent:resend:${consent.id}`, {
    limit: CONSENT_RESENDS_PER_DAY,
    windowMs: 24 * HOUR_MS,
    tenantId: consent.tenant_id,
  })
  if (!perConsent.ok) return busy(perConsent.retryAfterSeconds)
  const perTenant = await limitRequests('tenant-guardian-consent:invitations', {
    limit: GUARDIAN_INVITES_PER_TENANT_PER_HOUR,
    windowMs: HOUR_MS,
    tenantId: consent.tenant_id,
  })
  if (!perTenant.ok) return busy(perTenant.retryAfterSeconds)

  // The invitation, if it never went. Signers already invited are left alone.
  const invite = await sendTenantSigningInvitation(db, { tenantId: consent.tenant_id, envelopeRowId: consent.agreement_id })
  if (!invite.ok) {
    switch (invite.reason) {
      case 'disabled':
        return json(409, { code: 'tenant_mail_off', error: RESEND_MESSAGES.mailOff })
      case 'no_sender':
        return json(409, { code: 'no_sender', error: TENANT_SENDER_REQUIRED })
      case 'not_out_for_signature':
        return json(409, { code: 'not_out_for_signature', error: RESEND_MESSAGES.closed })
      case 'failed':
        return json(502, { error: TENANT_SIGNING_FAILED })
      default:
        // 'stellr' or 'not_found': the envelope is not this organiser's live consent form.
        return json(404, { code: 'no_pending_consent', error: RESEND_MESSAGES.none })
    }
  }
  const { sent, deferred, failed } = invite.result
  if (failed > 0) return json(502, { error: TENANT_SIGNING_FAILED })
  if (sent > 0) return json(200, { ok: true, outcome: 'sent' })
  if (deferred > 0) return json(200, { ok: true, outcome: 'deferred' })

  // Already invited: chase the guardian on the same envelope.
  const envelope = await loadRecord<Envelope>(crew.scope, 'agreements', consent.agreement_id, {
    db,
    select: 'envelope_id, provider',
    notFound: () => json(404, { code: 'no_pending_consent', error: RESEND_MESSAGES.none }),
    label: ROUTE,
  })
  if (!envelope.ok) return envelope.response
  try {
    const reminded = await remindEnvelopeRow(db, envelope.row)
    if (reminded === 0) return json(409, { code: 'not_out_for_signature', error: RESEND_MESSAGES.closed })
  } catch (err) {
    if (err instanceof TenantSenderRequiredError) return json(409, { code: 'no_sender', error: TENANT_SENDER_REQUIRED })
    console.error(`[admin/guardian-consent] reminder for consent ${consent.id} failed:`, err instanceof Error ? err.message : err)
    return json(502, { error: TENANT_SIGNING_FAILED })
  }
  return json(200, { ok: true, outcome: 'reminded' })
}
