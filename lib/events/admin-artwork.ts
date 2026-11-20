// The writes behind app/api/admin/events/[slug]/{badge-templates,certificate-templates},
// moved here as they were when the routes became tenant_crew (S5 wave 8, C19a):
// test/route-manifest.test.ts holds a tenant_crew file off a direct .from(). Badges and
// certificates print on Stellr's artwork and say Stellr Education, and a certificate goes
// with the credential that is not issued for another tenant's event (decision W7-9; SQ-16's
// default), so the routes answer stellrOnlyEvent first and every helper here takes a
// StellrOnlyDb, which only stellrOnlyDb hands out, in Stellr's scope.
//
// The reads (lib/event-badges.ts, lib/event-certificates.ts) stay where they are: the
// member-side certificate download and the artwork defaults share them.
import type { BadgeAudience, BadgeFormat } from '@/lib/badge-layout'
import type { AwardType } from '@/lib/event-awards'
import type { StellrOnlyDb } from '@/lib/events/admin-records'

// ── Badge templates ─────────────────────────────────────────────────────────

/**
 * Is this company one of the event's? The badge route's own copy of the check: importing
 * lib/events/admin-config would put the route in the tenant-db CI job's scope
 * (test/ci-tenant-db-required.test.ts), and this route never reads through tenantDb.
 */
export async function eventHasCompany(db: StellrOnlyDb, slug: string, companyId: string): Promise<boolean> {
  const { data } = await db.from('event_companies').select('id').eq('id', companyId).eq('event_slug', slug).maybeSingle()
  return Boolean(data)
}

/** The id of the event's badge background for this format and audience (and company), if it has one. */
export async function findEventBadgeTemplateId(
  db: StellrOnlyDb,
  slug: string,
  slot: { format: BadgeFormat; audience: BadgeAudience; companyId: string | null },
): Promise<string | null> {
  let q = db.from('event_badge_templates').select('id').eq('event_slug', slug).eq('format', slot.format).eq('audience', slot.audience)
  q = slot.companyId ? q.eq('company_id', slot.companyId) : q.is('company_id', null)
  const { data } = await q.maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Update the event's existing background, or add one for the slot. Answers the row's id. */
export async function saveEventBadgeTemplate(
  db: StellrOnlyDb,
  slug: string,
  existingId: string | null,
  slot: { format: BadgeFormat; audience: BadgeAudience; companyId: string | null },
  update: Record<string, unknown>,
) {
  return existingId
    ? db.from('event_badge_templates').update(update).eq('id', existingId).select('id').single()
    : db
        .from('event_badge_templates')
        .insert({ ...update, event_slug: slug, format: slot.format, audience: slot.audience, company_id: slot.companyId })
        .select('id')
        .single()
}

/** Remove one of the event's own backgrounds. */
export async function deleteEventBadgeTemplate(db: StellrOnlyDb, slug: string, id: string) {
  return db.from('event_badge_templates').delete().eq('event_slug', slug).eq('id', id)
}

// ── Certificate templates ───────────────────────────────────────────────────

/**
 * Save the event's artwork or placement for an award. Postgres checks NOT NULL on the row an
 * upsert would insert before it finds the conflict, so a placement-only save (no
 * artwork_path) on an existing row must be an update.
 */
export async function saveEventCertificateTemplate(
  db: StellrOnlyDb,
  slug: string,
  awardType: AwardType,
  exists: boolean,
  update: Record<string, unknown>,
) {
  return exists
    ? db.from('event_certificate_templates').update(update).eq('event_slug', slug).eq('award_type', awardType)
    : db.from('event_certificate_templates').upsert(update, { onConflict: 'event_slug,award_type' })
}

/** Drop the event's own artwork for an award, so its theme default prints again. */
export async function deleteEventCertificateTemplate(db: StellrOnlyDb, slug: string, awardType: AwardType) {
  return db.from('event_certificate_templates').delete().eq('event_slug', slug).eq('award_type', awardType)
}
