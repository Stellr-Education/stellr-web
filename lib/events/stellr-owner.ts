// Stellr's pages and another tenant's event (S5 wave 8, K11 canary probe P4).
//
// A Stellr page reads its event from the CMS by slug alone, and the CMS holds every
// tenant's event documents. So before a Stellr page shows an event, it asks whose event
// it is. The tenant tree has requireTenantEvent for the same job (lib/tenancy/tenant-records.ts);
// this is Stellr's side of it.
//
// The owner is C20c's read (loadEventTenantId, as refuseUnlessStellrEvent asks it): the
// events mirror by slug, an unmirrored slug counting as Stellr's. Another tenant's event
// gets the page's normal not-found, the answer for a slug nobody has. A failed owner read
// is never Stellr's: it throws, so the page's error boundary shows a retryable error,
// as an outage of the CMS read does on /events/[slug] (deep review PUB-9) and as C20c
// answers a retryable 503. It is never a 404, which would tell a family arriving from a
// flyer that a live event does not exist.
//
// A page calls it after its own event read has found the event, so a slug nobody has
// answers exactly as before, with no extra read. The individual and group registration
// pages share their body with the tenant tree, so their check sits in a Stellr layout
// beside the page instead; an unmirrored slug passes it, and the body's own not-found
// answers as before. test/stellr-event-owner-pages.test.tsx holds every such page to one.

import { cache } from 'react'
import { notFound } from 'next/navigation'
import { loadEventTenantId } from '@/lib/authz/principal'
import { supabaseServer } from '@/lib/supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

/** Thrown when the owner of an event cannot be read. The error boundary answers it. */
export class EventOwnerUnavailableError extends Error {
  constructor() {
    super('The event owner could not be read')
    this.name = 'EventOwnerUnavailableError'
  }
}

// One read per request, however many places in the render ask (generateMetadata and the page).
const ownerOf = cache(async (slug: string): Promise<string> => {
  try {
    return await loadEventTenantId(supabaseServer(), slug)
  } catch (err) {
    console.error('[stellr-event] event owner lookup failed:', err instanceof Error ? err.message : err)
    throw new EventOwnerUnavailableError()
  }
})

/** Whether Stellr's pages may show this event. Throws EventOwnerUnavailableError when the owner read fails. */
export async function isStellrEvent(slug: string): Promise<boolean> {
  return (await ownerOf(slug)) === STELLR_TENANT_ID
}

/**
 * For a Stellr page that shows one event by slug: the normal not-found for another
 * tenant's event, a thrown EventOwnerUnavailableError when the owner read fails, and
 * nothing for Stellr's own events, which render as ever.
 */
export async function requireStellrEvent(slug: string): Promise<void> {
  if (!(await isStellrEvent(slug))) notFound()
}
