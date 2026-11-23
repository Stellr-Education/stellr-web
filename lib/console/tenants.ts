/**
 * lib/console/tenants.ts — the super-admin console's data (S6-CON, docs/PLAN-S6-DRAFT.md
 * slice 7; docs/S6-DESIGN.md).
 *
 * Aggregates only. The console shows tenants, their hosts, how many people hold each
 * role, usage counts and how much support activity there has been. It never shows a
 * person: no names, emails, member or Clerk ids, and no support reason (free text a
 * person wrote, which may name someone). A person's data is reachable only inside a
 * support session (S6-SUP), never here.
 *
 * Read with the service client, by a platform admin, after assertPlatformAdmin: the
 * console acts across tenants, which no tenant role may do. Pure aggregation is split
 * out (summarise*) so it is tested without a database.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const USAGE_WINDOW_DAYS = 30
export const USAGE_KINDS = ['registration', 'event', 'email', 'identity'] as const
export type UsageKind = (typeof USAGE_KINDS)[number]
export const TENANT_ROLES = ['tenant_admin', 'event_manager', 'staff'] as const
export type TenantRoleName = (typeof TENANT_ROLES)[number]
export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'archived'

export interface TenantRow {
  id: string
  slug: string
  display_name: string
  country: string
  status: TenantStatus
  is_platform_owner: boolean
  created_at: string
}

export type UsageTotals = Record<UsageKind, number>
export type RoleCounts = Record<TenantRoleName, number>

export interface TenantSummary {
  id: string
  slug: string
  name: string
  country: string
  status: TenantStatus
  isPlatformOwner: boolean
  createdAt: string
  hosts: number
  roles: RoleCounts
  /** Totals over the last USAGE_WINDOW_DAYS, from usage_daily. */
  usage: UsageTotals
}

export interface SupportActivity {
  /** Support sessions open now (not closed, not ended). */
  open: number
  /** Sessions opened in the window, by mode. */
  read: number
  breakGlass: number
  /** Break-glass requests waiting for the tenant's answer and not lapsed. */
  pendingConsents: number
}

export interface TenantDetail extends TenantSummary {
  hostNames: string[]
  /** One entry per day in the window, oldest first, every kind present (0 when none). */
  usageByDay: { day: string; totals: UsageTotals }[]
  support: SupportActivity
}

const zeroUsage = (): UsageTotals => ({ registration: 0, event: 0, email: 0, identity: 0 })
const zeroRoles = (): RoleCounts => ({ tenant_admin: 0, event_manager: 0, staff: 0 })
const isUsageKind = (k: unknown): k is UsageKind => typeof k === 'string' && (USAGE_KINDS as readonly string[]).includes(k)
const isRole = (r: unknown): r is TenantRoleName => typeof r === 'string' && (TENANT_ROLES as readonly string[]).includes(r)

/** The first day (UTC, YYYY-MM-DD) of the window ending today. */
export function windowStart(now: number = Date.now(), days: number = USAGE_WINDOW_DAYS): string {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - (days - 1))
  return d.toISOString().slice(0, 10)
}

/** Every day of the window, oldest first. */
export function windowDays(now: number = Date.now(), days: number = USAGE_WINDOW_DAYS): string[] {
  const start = Date.parse(`${windowStart(now, days)}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10))
}

/** Pure: one summary per tenant, owner first, then by name. Unknown roles and kinds are ignored. */
export function summariseTenants(
  tenants: TenantRow[],
  domains: { tenant_id: string }[],
  memberships: { tenant_id: string; role: string }[],
  usage: { tenant_id: string; kind: string; total: number | string }[],
): TenantSummary[] {
  const hosts = new Map<string, number>()
  for (const d of domains) hosts.set(d.tenant_id, (hosts.get(d.tenant_id) ?? 0) + 1)
  const roles = new Map<string, RoleCounts>()
  for (const m of memberships) {
    if (!isRole(m.role)) continue
    const r = roles.get(m.tenant_id) ?? zeroRoles()
    r[m.role] += 1
    roles.set(m.tenant_id, r)
  }
  const totals = new Map<string, UsageTotals>()
  for (const u of usage) {
    if (!isUsageKind(u.kind)) continue
    const t = totals.get(u.tenant_id) ?? zeroUsage()
    t[u.kind] += Number(u.total) || 0
    totals.set(u.tenant_id, t)
  }
  return tenants
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.display_name,
      country: t.country,
      status: t.status,
      isPlatformOwner: t.is_platform_owner,
      createdAt: t.created_at,
      hosts: hosts.get(t.id) ?? 0,
      roles: roles.get(t.id) ?? zeroRoles(),
      usage: totals.get(t.id) ?? zeroUsage(),
    }))
    .sort((a, b) => Number(b.isPlatformOwner) - Number(a.isPlatformOwner) || a.name.localeCompare(b.name))
}

/** Pure: the window's days, each with every kind, from usage_daily rows. */
export function usageSeries(rows: { day: string; kind: string; total: number | string }[], days: string[]): TenantDetail['usageByDay'] {
  const byDay = new Map(days.map((d) => [d, zeroUsage()]))
  for (const r of rows) {
    const t = byDay.get(r.day)
    if (t && isUsageKind(r.kind)) t[r.kind] += Number(r.total) || 0
  }
  return days.map((day) => ({ day, totals: byDay.get(day)! }))
}

/** Pure: support counts from session and consent rows. Reads no reason and no person. */
export function summariseSupport(
  sessions: { mode: string; opened_at: string; ends_at: string; closed_at: string | null }[],
  consents: { approved_at: string | null; declined_at: string | null; withdrawn_at: string | null; expires_at: string }[],
  now: number,
  from: string,
): SupportActivity {
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  let open = 0
  let read = 0
  let breakGlass = 0
  for (const s of sessions) {
    if (!s.closed_at && Date.parse(s.ends_at) > now) open++
    if (Date.parse(s.opened_at) >= fromMs) {
      if (s.mode === 'break_glass') breakGlass++
      else read++
    }
  }
  const pendingConsents = consents.filter((c) => !c.approved_at && !c.declined_at && !c.withdrawn_at && Date.parse(c.expires_at) > now).length
  return { open, read, breakGlass, pendingConsents }
}

export class ConsoleReadError extends Error {
  constructor(what: string) {
    super(`Could not load ${what}.`)
    this.name = 'ConsoleReadError'
  }
}

async function rows<T>(what: string, q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q
  if (error) throw new ConsoleReadError(what)
  return (data ?? []) as T[]
}

const TENANT_COLUMNS = 'id, slug, display_name, country, status, is_platform_owner, created_at'

/** Every tenant, summarised. Throws ConsoleReadError when a read fails. */
export async function listTenants(db: SupabaseClient, now: number = Date.now()): Promise<TenantSummary[]> {
  const from = windowStart(now)
  const [tenants, domains, memberships, usage] = await Promise.all([
    rows<TenantRow>('tenants', db.from('tenants').select(TENANT_COLUMNS)),
    rows<{ tenant_id: string }>('hosts', db.from('tenant_domains').select('tenant_id')),
    rows<{ tenant_id: string; role: string }>('roles', db.from('tenant_memberships').select('tenant_id, role')),
    rows<{ tenant_id: string; kind: string; total: number }>('usage', db.from('usage_daily').select('tenant_id, kind, total').gte('day', from)),
  ])
  return summariseTenants(tenants, domains, memberships, usage)
}

/** One tenant in detail, or null when there is none. Throws ConsoleReadError when a read fails. */
export async function loadTenantDetail(db: SupabaseClient, tenantId: string, now: number = Date.now()): Promise<TenantDetail | null> {
  const from = windowStart(now)
  const tenant = (await rows<TenantRow>('the tenant', db.from('tenants').select(TENANT_COLUMNS).eq('id', tenantId)))[0]
  if (!tenant) return null
  const [domains, memberships, usage, sessions, consents] = await Promise.all([
    rows<{ tenant_id: string; host: string }>('hosts', db.from('tenant_domains').select('tenant_id, host').eq('tenant_id', tenantId)),
    rows<{ tenant_id: string; role: string }>('roles', db.from('tenant_memberships').select('tenant_id, role').eq('tenant_id', tenantId)),
    rows<{ tenant_id: string; day: string; kind: string; total: number }>(
      'usage',
      db.from('usage_daily').select('tenant_id, day, kind, total').eq('tenant_id', tenantId).gte('day', from),
    ),
    rows<{ mode: string; opened_at: string; ends_at: string; closed_at: string | null }>(
      'support sessions',
      db.from('support_sessions').select('mode, opened_at, ends_at, closed_at').eq('tenant_id', tenantId).or(`closed_at.is.null,opened_at.gte.${from}`),
    ),
    rows<{ approved_at: string | null; declined_at: string | null; withdrawn_at: string | null; expires_at: string }>(
      'break-glass requests',
      db.from('support_consents').select('approved_at, declined_at, withdrawn_at, expires_at').eq('tenant_id', tenantId).gt('expires_at', new Date(now).toISOString()),
    ),
  ])
  const [summary] = summariseTenants([tenant], domains, memberships, usage)
  return {
    ...summary,
    hostNames: domains.map((d) => d.host).sort(),
    usageByDay: usageSeries(usage, windowDays(now)),
    support: summariseSupport(sessions, consents, now, from),
  }
}

// ── S6-CON-b: per-tenant errors ──────────────────────────────────────────────

export const ERROR_WINDOW_DAYS = 7
export const TOP_ERROR_ROUTES = 5

export interface TenantErrors {
  /** Distinct errors (digests) seen in the window. */
  distinct: number
  /** Their occurrences, all time: app_errors keeps one running count per digest. */
  total: number
  /** The routes with the most occurrences, most first. Route patterns only, never a message. */
  topRoutes: { route: string; count: number }[]
}

/** Pure: the console's error summary from app_errors rows. Reads route and count only. */
export function summariseErrors(rows: { route: string; count: number | string }[], top: number = TOP_ERROR_ROUTES): TenantErrors {
  const byRoute = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    const n = Number(r.count) || 0
    total += n
    byRoute.set(r.route, (byRoute.get(r.route) ?? 0) + n)
  }
  const topRoutes = [...byRoute.entries()]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
    .slice(0, top)
  return { distinct: rows.length, total, topRoutes }
}

/**
 * Errors a tenant's hosts raised in the last ERROR_WINDOW_DAYS (app_errors.tenant_id,
 * captured from the proxy's tenant header). The message is never read: route and count
 * are enough for the console, and a person's data stays out of it.
 */
export async function loadTenantErrors(db: SupabaseClient, tenantId: string, now: number = Date.now()): Promise<TenantErrors> {
  const since = new Date(now - ERROR_WINDOW_DAYS * 86_400_000).toISOString()
  const data = await rows<{ route: string; count: number }>(
    'errors',
    db.from('app_errors').select('route, count').eq('tenant_id', tenantId).gte('last_seen', since),
  )
  return summariseErrors(data)
}
