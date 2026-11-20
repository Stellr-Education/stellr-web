// The site origin a participant link for an event belongs on (S5 wave 8, A12).
//
// A check-in code's QR and its email button used to open SITE_URL, Stellr's host, for every
// event. Another tenant's participants are served on that tenant's own host (the tenant
// tree), so their links must open there. This answers the origin for an event's links:
//
//   routing off (TENANT_ROUTING_ENABLED unset, every environment today): SITE_URL, with no
//     read, so Stellr's links are byte-identical;
//   a Stellr event (the events mirror's owner, an unmirrored slug counting as Stellr's):
//     SITE_URL;
//   another tenant's event: that tenant's primary host, if the tenant is active, with
//     SITE_URL's protocol and port (https in a hosted zone; http and the dev port on
//     .localhost);
//   anything unknown or unreadable: null. The caller then builds no link, rather than a
//     link to Stellr's host that would refuse the event there (the Stellr check-in layout).
import type { SupabaseClient } from '@supabase/supabase-js'
import { SITE_URL } from '@/lib/env'
import { loadEventTenantId } from '@/lib/authz/principal'
import { supabaseServer } from '@/lib/supabase'
import { STELLR_TENANT_ID } from './constants'
import { tenantRoutingConfig } from './host'

type Env = Record<string, string | undefined>

/** SITE_URL with its hostname swapped for `host`: the same protocol and port. */
export function originOnHost(host: string, siteUrl: string = SITE_URL): string {
  const u = new URL(siteUrl)
  u.hostname = host
  return u.origin
}

/**
 * The origin for links of `tenantId`'s records: SITE_URL with routing off (no read) or for
 * Stellr; the tenant's primary active host otherwise; null when there is none or the read
 * fails. For a record whose tenant is known (an agreement's tenant_id, say).
 */
export async function tenantSiteOrigin(
  tenantId: string,
  opts: { db?: SupabaseClient; env?: Env; siteUrl?: string } = {},
): Promise<string | null> {
  const siteUrl = opts.siteUrl ?? SITE_URL
  if (!tenantRoutingConfig(opts.env ?? process.env).enabled) return siteUrl
  if (tenantId === STELLR_TENANT_ID) return siteUrl
  const db = opts.db ?? supabaseServer()
  try {
    const { data, error } = await db
      .from('tenant_domains')
      .select('host, tenants!inner(status)')
      .eq('tenant_id', tenantId)
      .eq('is_primary', true)
      .eq('tenants.status', 'active')
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const host = (data as { host?: unknown }).host
    return typeof host === 'string' && host ? originOnHost(host, siteUrl) : null
  } catch {
    return null
  }
}

/** The origin for an event's participant links: its owner's (tenantSiteOrigin), from the events mirror. */
export async function eventSiteOrigin(
  slug: string,
  opts: { db?: SupabaseClient; env?: Env; siteUrl?: string } = {},
): Promise<string | null> {
  const siteUrl = opts.siteUrl ?? SITE_URL
  if (!tenantRoutingConfig(opts.env ?? process.env).enabled) return siteUrl
  const db = opts.db ?? supabaseServer()
  try {
    return await tenantSiteOrigin(await loadEventTenantId(db, slug), { ...opts, db, siteUrl })
  } catch {
    return null
  }
}
