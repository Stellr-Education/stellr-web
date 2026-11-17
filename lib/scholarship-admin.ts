import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currentTenantId, hasCapability, type Capability } from '@/lib/authz'
import { getSignedInMember } from '@/lib/community'
import type { Reviewer } from '@/lib/scholarship-offer'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { loadRecord, refuseOutsideStellr, refuseUnlessStellrEvent, type LoadedRecord } from '@/lib/tenancy/load-scoped'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

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

// ── Stellr-only (S5 wave 8, C20b) ────────────────────────────────────────────
//
// Scholarships draw on Stellr's coupons and Stripe account, and tenants get none in
// release 1 (WD-4 and SQ-16: Stellr-only until S9). So every admin scholarship route loads
// its application through loadScoped, in the reviewer's scope, and refuses one on another
// tenant's event the way C20c refuses money routes: for everyone, a Stellr admin included,
// in every LOADSCOPED_MODE (off and shadow do not narrow the read), before any email,
// Stripe call or write. Another tenant's event answers as a missing application; a failed
// read of the event's owner is a retryable 503, never Stellr's.

/** The answer for an application that does not exist, or is not one of Stellr's. */
export const scholarshipNotFound = () => NextResponse.json({ error: 'Application not found' }, { status: 404 })

/** The reviewer's scope. A scholarship capability is only ever held in Stellr's context (decideCapability). */
export function scholarshipScope() {
  return tenantWideScope(currentTenantId(), 'tenant_admin')
}

/**
 * Another tenant's event is refused: `notFound`, or a retryable 503 when the owner read
 * fails. Null for one of Stellr's events (an unmirrored slug counts as Stellr's), or none.
 */
export async function refuseUnlessStellrScholarshipEvent(
  db: SupabaseClient,
  eventSlug: string | null | undefined,
  label: string,
  notFound: () => Response = scholarshipNotFound,
): Promise<Response | null> {
  if (!eventSlug) return null
  const refused = await refuseUnlessStellrEvent(db, eventSlug, label)
  if (!refused) return null
  return refused.status === 404 ? notFound() : refused
}

type ApplicationRef = { id: string; event_slug: string | null; tenant_id: string | null }

/**
 * The application `id`, loaded through loadScoped in the reviewer's scope, when it is one of
 * Stellr's: its own tenant (an unstamped row is Stellr's, as the enforced read takes it) and
 * its event's owner. Anything else answers as `notFound`, and a failed owner read as a 503.
 */
export async function loadStellrScholarship<T extends ApplicationRef = ApplicationRef>(
  db: SupabaseClient,
  id: string,
  opts: { label: string; select?: string; notFound?: () => Response },
): Promise<LoadedRecord<T>> {
  const notFound = opts.notFound ?? scholarshipNotFound
  const scope = scholarshipScope()
  const outside = refuseOutsideStellr(scope)
  if (outside) return { ok: false, response: outside }
  const loaded = await loadRecord<T>(scope, 'scholarship_applications', id, {
    db,
    select: opts.select ?? 'id, event_slug, tenant_id',
    notFound,
    label: opts.label,
  })
  if (!loaded.ok) return loaded
  if ((loaded.row.tenant_id ?? STELLR_TENANT_ID) !== STELLR_TENANT_ID) return { ok: false, response: notFound() }
  const foreign = await refuseUnlessStellrScholarshipEvent(db, loaded.row.event_slug, opts.label, notFound)
  if (foreign) return { ok: false, response: foreign }
  return loaded
}
