// The events facade with a tenant (multi-tenancy plan S5, C8-PG callers; S5 wave 8).
//
// lib/events/repo.ts reads Sanity only and stays that way: pages import it, and a page must
// load no database client (test/events-facade-ratchet.test.ts). This module is its
// server-only twin for code that knows whose event it reads: a cron, a mail job, the admin
// digest. Each getter takes an explicit tenant id, from a registration, an email row or the
// caller's own Stellr-only rows, never from headers or the Host. A missing tenant throws.
//
// The read goes through the 'events-read' area (lib/tenancy/area-switch.ts):
//   service  today's Sanity read, exactly as lib/events/repo.ts returns it. The tenant id is
//            checked and otherwise unused: with TENANT_DB_AREAS unset this is the only path,
//            so every caller reads what it read before (Stellr passes Stellr's id).
//   shadow   Sanity answers; for a sampled share the mirror is read too, through tenantDb,
//            and the slug sets compared after the response.
//   tenant   the mirror answers, through tenantDb, so the row level security policy on
//            public.events keeps the read inside the tenant. A slug another tenant holds
//            is simply absent (decision WD-11 default: slugs stay globally unique, but the
//            read never relies on it). Fields the mirror lacks (MIRROR_DETAIL_GAPS) are
//            absent in this mode; the callers here read none of them.
//
// Tenant mode waits on the production mirror backfill and the owner's switch; nothing turns
// it on here.
import { getEventBySlug, getEventsByIds, getEventsBySlugs } from '@/lib/events/repo'
import { readArea, type DataArea } from '@/lib/tenancy/area-switch'
import type { TenantDb } from '@/lib/tenancy/db'
import {
  requireTenantId,
  toEventDetail,
  toEventIdMeta,
  toEventMeta,
  type TenantEventDetail,
  type TenantEventIdMeta,
  type TenantEventMeta,
  type TenantEventRow,
} from '@/lib/events/tenant-repo'

/** The area name in TENANT_DB_AREAS. */
export const EVENTS_READ_AREA: DataArea = 'events-read'

type SanityEvent = Awaited<ReturnType<typeof getEventBySlug>>
type SanityMetas = Awaited<ReturnType<typeof getEventsBySlugs>>
type SanityIdMetas = Awaited<ReturnType<typeof getEventsByIds>>

/** Compared in shadow mode: which events came back, by slug. Content differs by design (MIRROR_DETAIL_GAPS). */
const bySlug = {
  key: (row: { slug?: { current?: string } } | null) => row?.slug?.current ?? null,
  normalise: (row: { slug?: { current?: string } } | null) => row?.slug?.current ?? null,
  showIds: ['slug'] as const,
}

function cleanList(values: string[]): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))]
}

// ── The tenantDb reads ──────────────────────────────────────────────────────
// Timestamps come back as ISO text (to_json), the form supabase-js returns and the
// tenant-repo mappers read. The tenant filter is the policy's and is checked again here.

export async function tenantEventBySlug(db: TenantDb, slug: string): Promise<TenantEventDetail | null> {
  if (typeof slug !== 'string' || !slug) return null
  const rows = await db.sql<TenantEventRow>`
    SELECT tenant_id::text AS tenant_id, slug, sanity_id, title, activity_type,
      to_json(starts_at) #>> '{}' AS starts_at, to_json(ends_at) #>> '{}' AS ends_at,
      time_zone, country, status, raw
    FROM public.events WHERE slug = ${slug}`
  const row = rows.find((r) => r.tenant_id === db.tenantId)
  return row ? toEventDetail(row) : null
}

async function tenantRowsIn(db: TenantDb, column: 'slug' | 'sanity_id', values: string[]): Promise<TenantEventRow[]> {
  const list = cleanList(values)
  if (list.length === 0) return []
  const rows =
    column === 'slug'
      ? await db.sql<TenantEventRow>`
          SELECT tenant_id::text AS tenant_id, slug, sanity_id, title, activity_type,
            to_json(starts_at) #>> '{}' AS starts_at, to_json(ends_at) #>> '{}' AS ends_at,
            time_zone, country, status, raw
          FROM public.events WHERE slug = ANY(${list}::text[])`
      : await db.sql<TenantEventRow>`
          SELECT tenant_id::text AS tenant_id, slug, sanity_id, title, activity_type,
            to_json(starts_at) #>> '{}' AS starts_at, to_json(ends_at) #>> '{}' AS ends_at,
            time_zone, country, status, raw
          FROM public.events WHERE sanity_id = ANY(${list}::text[])`
  return rows.filter((r) => r.tenant_id === db.tenantId)
}

export async function tenantEventsBySlugs(db: TenantDb, slugs: string[]): Promise<TenantEventMeta[]> {
  return (await tenantRowsIn(db, 'slug', slugs)).map(toEventMeta)
}

export async function tenantEventsByIds(db: TenantDb, ids: string[]): Promise<TenantEventIdMeta[]> {
  return (await tenantRowsIn(db, 'sanity_id', ids)).map(toEventIdMeta)
}

// ── The getters ─────────────────────────────────────────────────────────────

/** One event by slug, for `tenantId`. Service mode: lib/events/repo getEventBySlug, unchanged. */
export function getEventBySlugIn(tenantId: string, slug: string): Promise<SanityEvent> {
  const tenant = requireTenantId(tenantId)
  return readArea<SanityEvent, { slug?: { current?: string } } | null>(EVENTS_READ_AREA, {
    tenantId: tenant,
    label: 'events facade getEventBySlug',
    service: () => getEventBySlug(slug),
    tenant: async (db) => (await tenantEventBySlug(db, slug)) as SanityEvent,
    ...bySlug,
  })
}

/** Minimal metadata for these slugs, for `tenantId`. Service mode: lib/events/repo getEventsBySlugs, unchanged. */
export function getEventsBySlugsIn(tenantId: string, slugs: string[]): Promise<SanityMetas> {
  const tenant = requireTenantId(tenantId)
  return readArea<SanityMetas, { slug?: { current?: string } } | null>(EVENTS_READ_AREA, {
    tenantId: tenant,
    label: 'events facade getEventsBySlugs',
    service: () => getEventsBySlugs(slugs),
    tenant: async (db) => (await tenantEventsBySlugs(db, slugs)) as SanityMetas,
    ...bySlug,
  })
}

/** Minimal metadata for these Sanity ids, for `tenantId`. Service mode: lib/events/repo getEventsByIds, unchanged. */
export function getEventsByIdsIn(tenantId: string, ids: string[]): Promise<SanityIdMetas> {
  const tenant = requireTenantId(tenantId)
  return readArea<SanityIdMetas, { slug?: { current?: string } } | null>(EVENTS_READ_AREA, {
    tenantId: tenant,
    label: 'events facade getEventsByIds',
    service: () => getEventsByIds(ids),
    tenant: async (db) => (await tenantEventsByIds(db, ids)) as SanityIdMetas,
    ...bySlug,
  })
}
