/**
 * lib/support/read-view.ts — what a support session shows of its tenant (S6-SUP-UI).
 *
 * Reads ONLY through the tenantDb it is given, which the support page opens with
 * tenantSupportDb (lib/tenancy/support-db.ts): tenant_support_ro, READ ONLY, pinned to
 * the session's tenant. Never the service client, so another tenant's rows are invisible
 * to the database itself. Event-level facts and counts; no participant is listed.
 */
import type { TenantDb } from '@/lib/tenancy/db'

export interface SupportEventRow {
  slug: string
  title: string
  status: string | null
  startsAt: string | null
  registrations: number
  participants: number
}

/** The session tenant's events, newest first, with registration and participant counts. */
export async function supportEvents(db: TenantDb, limit = 50): Promise<SupportEventRow[]> {
  const rows = await db.sql<{
    slug: string
    title: string
    status: string | null
    starts_at: string | null
    registrations: string | number
    participants: string | number
  }>`
    SELECT e.slug, e.title, e.status, e.starts_at::text AS starts_at,
      (SELECT count(*) FROM public.registrations r WHERE r.event_slug = e.slug) AS registrations,
      (SELECT count(*) FROM public.participants p JOIN public.registrations r ON r.id = p.registration_id
        WHERE r.event_slug = e.slug) AS participants
    FROM public.events e
    ORDER BY e.starts_at DESC NULLS LAST, e.slug
    LIMIT ${limit}::int`
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    status: r.status,
    startsAt: r.starts_at,
    registrations: Number(r.registrations) || 0,
    participants: Number(r.participants) || 0,
  }))
}

/** The companies of one event, by number, with how many participants each holds. */
export async function supportEventCompanies(db: TenantDb, slug: string): Promise<{ id: string; number: number; name: string | null; participants: number }[]> {
  const rows = await db.sql<{ id: string; number: number; name: string | null; participants: string | number }>`
    SELECT c.id::text AS id, c.number, c.name,
      (SELECT count(*) FROM public.participants p WHERE p.company_id = c.id) AS participants
    FROM public.event_companies c
    WHERE c.event_slug = ${slug}
    ORDER BY c.number`
  return rows.map((r) => ({ id: r.id, number: r.number, name: r.name, participants: Number(r.participants) || 0 }))
}
