import { NextResponse } from 'next/server'
import { withAudit } from '@/lib/audit/route'
import { requireEventRoute } from '@/lib/authz'
import { requireStepUp } from '@/lib/authz/step-up'
import { getEventRoster } from '@/lib/event-admin'
import { toCsv } from '@/lib/csv'
import { extrasByParticipant } from '@/lib/addons/admin'
import { logRecordAccess } from '@/lib/record-access-log'
import { displayGrade } from '@/lib/member-enums'
import { supabaseServer } from '@/lib/supabase'
import { MEDIA_REASON_LABEL, mediaForParticipants } from '@/lib/survey/media'
import { optOutCell, rosterOptOuts } from '@/lib/roster-optouts'
import { enforcedTenantFilter } from '@/lib/tenancy/load-scoped'
import { isStellrScope } from '@/lib/tenancy/scope-context'

// GET /api/admin/events/[slug]/export — roster CSV (admins + assigned event managers)
// media_ok: may Stellr use this person's photo/media (lib/survey/media.ts) —
// yes, no, or check (read the signed form); the reason is beside it.
//
// That answer rests on shared member settings and on forms signed for any organiser, so it
// is Stellr's alone. A tenant's staff get "check" for everyone: A10 and A11 say what a
// tenant's own answer is.
//
// Quote opt-out, Digital comms opt-out (esign-native-engine.9): the boxes ticked on the
// signed agreement, as completion read them back for either signing engine
// (lib/roster-optouts.ts): yes, no (read and left unticked), or blank (not known). Stellr's
// alone for the same reason as media_ok, so a tenant's export leaves them blank.
const TENANT_MEDIA_NOTE = 'Not available for your organisation yet: check your own records'

async function exportRoster(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: '/api/admin/events/[slug]/export' })
  if (!crew.ok) return crew.response
  const stepUp = await requireStepUp()
  if (stepUp) return stepUp

  const roster = await getEventRoster(slug, undefined, { tenant: enforcedTenantFilter(crew.scope, 'registrations') })
  const stellr = isStellrScope(crew.scope)
  const media = stellr
    ? await mediaForParticipants(supabaseServer(), roster.groups.flatMap((g) => g.participants.map((p) => p.id)))
    : null
  const optOuts = stellr ? await rosterOptOuts(supabaseServer(), roster.groups.flatMap((g) => g.participants)) : null
  // Extras (lib/addons): Stellr's events only.
  type Extra = { lineId: string; title: string; status: string; checkedAt: string | null }
  const extras: Map<string, Extra[]> = stellr ? await extrasByParticipant(supabaseServer(), slug).catch(() => new Map<string, Extra[]>()) : new Map<string, Extra[]>()

  const header = [
    'Registration Type', 'Group', 'First Name', 'Last Name', 'Email', 'Role', 'School', 'Grade',
    'Gender', 'Date of Birth', 'Shirt Size', 'Dietary Requirements', 'Health Conditions',
    'Emergency Contact First Name', 'Emergency Contact Last Name', 'Emergency Contact Relationship',
    'Emergency Contact Email', 'Emergency Contact Phone',
    'Paid', 'Payment Status', 'DocuSign', 'DocuSign Status', 'Checked In At', 'media_ok', 'Media Note',
    'Quote opt-out', 'Digital comms opt-out', 'Extras',
  ]
  const rows = roster.groups.flatMap((g) =>
    g.participants.map((p) => [
      g.type,
      g.groupLabel ?? '',
      p.first_name,
      p.last_name,
      p.email,
      p.event_role ?? '',
      p.school_name ?? '',
      displayGrade(p.grade) ?? '',
      p.gender ?? '',
      p.date_of_birth ?? '',
      p.t_shirt_size ?? '',
      p.dietary_requirements.join('; '),
      p.health_conditions ?? '',
      p.emergency_contact_first_name ?? '',
      p.emergency_contact_last_name ?? '',
      p.emergency_contact_relationship ?? '',
      p.emergency_contact_email ?? '',
      p.emergency_contact_phone ?? '',
      p.paid ? 'yes' : 'no',
      p.payment_pill,
      p.docusign,
      p.docusign_pill,
      p.checked_in_at ?? '',
      media?.get(p.id)?.status ?? 'check',
      media ? MEDIA_REASON_LABEL[media.get(p.id)?.reason ?? 'form_unread'] : TENANT_MEDIA_NOTE,
      optOutCell(optOuts?.get(p.id)?.quotes),
      optOutCell(optOuts?.get(p.id)?.digital_comms),
      (extras.get(p.id) ?? []).map((x) => (x.status === 'confirmed' ? x.title : `${x.title} (${x.status === 'pending_payment' ? 'unpaid' : 'consent pending'})`)).join('; '),
    ])
  )

  const csv = toCsv([header, ...rows])
  // A roster CSV holds minors' medical and emergency details: every export is logged (Staff role phase 4).
  await logRecordAccess({ action: 'export', route: '/api/admin/events/[slug]/export', eventSlug: slug, rowCount: rows.length, detail: { kind: 'roster_csv' } })
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-participants.csv"`,
    },
  })
}

// Every export is audited (and in record_access_log): the CSV holds personal data (Staff role phase 4).
export const GET = withAudit(
  () => ({ action: 'export.roster' as const, actor: { session: true } as const, tenant: { stellr: true } as const, target: null }),
  exportRoster,
)
