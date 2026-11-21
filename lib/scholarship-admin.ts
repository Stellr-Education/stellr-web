import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasCapability, type Capability } from '@/lib/authz'
import { getSignedInMember } from '@/lib/community'
import type { Reviewer } from '@/lib/scholarship-offer'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { stellrOnlyDb, type StellrOnlyDb } from '@/lib/events/admin-records'
import { loadEventRecord, refuseOutsideStellr, stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import type { ScopeContext } from '@/lib/tenancy/scope-context'

/**
 * Scholarship review is admin-only (owner, 2 Oct 2026) — not event managers.
 * Returns the reviewer to record on the decision, or null when not an admin.
 */
export async function requireScholarshipAdmin(cap: Capability = 'scholarships:write'): Promise<Reviewer | null> {
  // Deciding stays admin-only (scholarships:write); Staff may read (portal:read).
  const { userId } = await auth()
  if (!(await hasCapability(cap))) return null
  const member = await getSignedInMember().catch(() => null)
  const name = member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || null : null
  return { clerkUserId: userId ?? null, memberId: member?.id ?? null, name }
}

// ── Stellr-only (S5 wave 8, C20b; tenant_crew since C20) ─────────────────────
//
// Scholarships draw on Stellr's coupons and Stripe account, and tenants get none in
// release 1 (WD-4 and SQ-16: Stellr-only until S9). So every admin scholarship route loads
// its application through loadScoped and refuses one on another tenant's event the way
// C20c refuses money routes: for everyone, a Stellr admin included, in every
// LOADSCOPED_MODE (off and shadow do not narrow the read), before any email, Stripe call or
// write. Another tenant's event answers as a missing application; a failed read of the
// event's owner is a retryable 503, never Stellr's.
//
// C20 (S5 wave 9) moved the routes to tenant_crew. Each asks requireScholarshipAdmin first
// (deciding stays admin-only, as the owner set on 2 Oct 2026), then lib/authz
// requireEventCrew, whose answer carries the scope to load in and the event check
// (`covers`). An application is keyed by its own id, not a slug, so its event_slug is read
// first (loadEventRecord) and the Stellr-only option (stellrOnlyEvent) is asked of that
// event, answering as a missing application. The client for the work that follows is a
// StellrOnlyDb, handed out only once the application is known to be Stellr's.

/** The answer for an application that does not exist, or is not one of Stellr's. */
export const scholarshipNotFound = () => NextResponse.json({ error: 'Application not found' }, { status: 404 })

/** What a scholarship route needs from requireEventCrew's answer: the scope to load in and the event check. */
export type ScholarshipCrew = { scope: ScopeContext; covers: (eventSlug: string | null | undefined) => boolean }

/**
 * Another tenant's event, or one the caller does not cover, is refused: `notFound`, or the
 * Stellr-only option's 503 (a tenant's staff, or a failed owner read). Null for one of
 * Stellr's events (an unmirrored slug counts as Stellr's), or none.
 */
export async function refuseUnlessStellrScholarshipEvent(
  crew: ScholarshipCrew,
  db: SupabaseClient,
  eventSlug: string | null | undefined,
  label: string,
  notFound: () => Response = scholarshipNotFound,
): Promise<Response | null> {
  if (!eventSlug) return null
  if (!crew.covers(eventSlug)) return notFound()
  const refused = await stellrOnlyEvent(crew.scope, db, eventSlug, label)
  if (!refused) return null
  return refused.status === 404 ? notFound() : refused
}

type ApplicationRef = { id: string; event_slug: string | null; tenant_id: string | null }

/** A loaded application, with the client for what the route does next: Stellr's scope only. */
export type LoadedScholarship<T> = { ok: true; row: T; db: StellrOnlyDb } | { ok: false; response: Response }

/**
 * The application `id`, loaded through loadScoped in the caller's scope, when it is one of
 * Stellr's: its own tenant (an unstamped row is Stellr's, as the enforced read takes it) and
 * its event's owner. Anything else answers as `notFound`, a tenant's staff get the
 * Stellr-only 503, and a failed owner read is a 503.
 */
export async function loadStellrScholarship<T extends ApplicationRef = ApplicationRef>(
  crew: ScholarshipCrew,
  db: SupabaseClient,
  id: string,
  opts: { label: string; select?: string; notFound?: () => Response },
): Promise<LoadedScholarship<T>> {
  const notFound = opts.notFound ?? scholarshipNotFound
  const outside = refuseOutsideStellr(crew.scope)
  if (outside) return { ok: false, response: outside }
  const loaded = await loadEventRecord<T>(crew, 'scholarship_applications', id, {
    db,
    select: opts.select ?? 'id, event_slug, tenant_id',
    notFound,
    label: opts.label,
  })
  if (!loaded.ok) return loaded
  if ((loaded.row.tenant_id ?? STELLR_TENANT_ID) !== STELLR_TENANT_ID) return { ok: false, response: notFound() }
  const foreign = await refuseUnlessStellrScholarshipEvent(crew, db, loaded.row.event_slug, opts.label, notFound)
  if (foreign) return { ok: false, response: foreign }
  return { ok: true, row: loaded.row, db: stellrOnlyDb(crew.scope, db) }
}

/** The reviewer's notes on an application loadStellrScholarship has placed in Stellr's scope. */
export async function saveScholarshipNotes(db: StellrOnlyDb, id: string, notes: string | null) {
  return db.from('scholarship_applications').update({ admin_notes: notes }).eq('id', id)
}
