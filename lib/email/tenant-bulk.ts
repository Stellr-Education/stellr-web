// A tenant's bulk-mail allowance (email plan E, re-scoped 23 Nov 2026).
//
// Tenants send no marketing, but an event-email blast to a whole event is bulk
// mail all the same: a runaway send can use up the month or draw enough
// complaints to put the shared Resend account at risk. Each tenant may have a
// daily and a monthly cap on blast sends, and a platform admin can pause its
// blasts (tenant_email_settings). Transactional mail to one person never meets
// this. Stellr has no row and so no cap: its bulk mail is held by the
// platform budget (lib/email-budget.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { billingPeriodStart, utcDay } from '@/lib/email-budget'

export interface BulkAllowance {
  /** How many more blast sends this tenant may make now; Infinity when uncapped. */
  remaining: number
  /** Why it is 0, when it is. */
  reason?: 'paused' | 'daily_cap' | 'monthly_cap' | 'unreadable'
}

/**
 * The tenant's remaining blast sends. Fails closed: if the settings or the count
 * cannot be read, the answer is 0 and the run stops for a later retry, exactly
 * like the platform budget refusing bulk mail.
 */
export async function tenantBulkAllowance(db: SupabaseClient, tenantId: string, now = new Date()): Promise<BulkAllowance> {
  try {
    const { data: s, error } = await db
      .from('tenant_email_settings')
      .select('bulk_daily_cap, bulk_monthly_cap, bulk_paused_at')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const settings = s as { bulk_daily_cap: number | null; bulk_monthly_cap: number | null; bulk_paused_at: string | null } | null
    if (settings?.bulk_paused_at) return { remaining: 0, reason: 'paused' }
    const daily = settings?.bulk_daily_cap ?? null
    const monthly = settings?.bulk_monthly_cap ?? null
    if (daily === null && monthly === null) return { remaining: Infinity }

    const { data: rows, error: countError } = await db
      .from('email_tenant_bulk_sends')
      .select('day, sent')
      .eq('tenant_id', tenantId)
      .gte('day', billingPeriodStart(now))
    if (countError) throw new Error(countError.message)
    const list = (rows ?? []) as { day: string; sent: number }[]
    const today = utcDay(now)
    const sentToday = list.filter((r) => r.day === today).reduce((n, r) => n + (r.sent ?? 0), 0)
    const sentMonth = list.reduce((n, r) => n + (r.sent ?? 0), 0)

    const leftToday = daily === null ? Infinity : Math.max(0, daily - sentToday)
    const leftMonth = monthly === null ? Infinity : Math.max(0, monthly - sentMonth)
    const remaining = Math.min(leftToday, leftMonth)
    if (remaining > 0) return { remaining }
    return { remaining: 0, reason: leftToday === 0 ? 'daily_cap' : 'monthly_cap' }
  } catch (err) {
    console.error(`[tenant-bulk] allowance read failed for tenant ${tenantId} — holding its blast:`, err instanceof Error ? err.message : err)
    return { remaining: 0, reason: 'unreadable' }
  }
}

/** Count blast sends that went out (or were queued to go). Best-effort: never throws. */
export async function recordTenantBulk(db: SupabaseClient, tenantId: string, n: number, now = new Date()): Promise<void> {
  if (n <= 0) return
  const { error } = await db.rpc('bump_tenant_bulk_sends', { p_tenant_id: tenantId, p_day: utcDay(now), p_n: n })
  if (error) console.error(`[tenant-bulk] count failed for tenant ${tenantId}:`, error.message)
}
