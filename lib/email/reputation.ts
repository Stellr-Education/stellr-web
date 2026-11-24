// Per-tenant sending reputation (email plan E, re-scoped 23 Nov 2026).
//
// From email_events: over the last week, how many messages each tenant's mail
// reached (delivered or bounced), how many bounced permanently, and how many drew
// a spam complaint. Above the thresholds, staff are alerted (app/api/cron/
// email-reputation) so a tenant can be paused before the shared Resend account
// is. Nothing is paused automatically: transactional mail (consent, receipts)
// must keep flowing, and a person decides.
//
// Thresholds sit below the providers' own review lines (complaints 0.1%, hard
// bounces 4%), and only count once a tenant has reached enough people for a rate
// to mean something.

import type { SupabaseClient } from '@supabase/supabase-js'

export const REPUTATION_WINDOW_DAYS = 7
export const MIN_REACHED = 200
export const COMPLAINT_RATE_ALERT = 0.001
export const HARD_BOUNCE_RATE_ALERT = 0.04

export interface TenantReputation {
  tenantId: string
  reached: number
  hardBounces: number
  complaints: number
  hardBounceRate: number
  complaintRate: number
  /** Why staff should look, or empty when all is well (or too few to tell). */
  concerns: ('complaints' | 'hard_bounces')[]
}

export function assess(row: { tenant_id: string; reached: number; hard_bounces: number; complaints: number }): TenantReputation {
  const reached = row.reached ?? 0
  const hardBounceRate = reached ? row.hard_bounces / reached : 0
  const complaintRate = reached ? row.complaints / reached : 0
  const concerns: TenantReputation['concerns'] = []
  if (reached >= MIN_REACHED) {
    if (complaintRate >= COMPLAINT_RATE_ALERT) concerns.push('complaints')
    if (hardBounceRate >= HARD_BOUNCE_RATE_ALERT) concerns.push('hard_bounces')
  }
  return { tenantId: row.tenant_id, reached, hardBounces: row.hard_bounces ?? 0, complaints: row.complaints ?? 0, hardBounceRate, complaintRate, concerns }
}

export async function tenantReputations(db: SupabaseClient, now = new Date()): Promise<TenantReputation[]> {
  const since = new Date(now.getTime() - REPUTATION_WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await db.rpc('tenant_email_reputation', { p_since: since })
  if (error) throw new Error(`reputation read failed: ${error.message}`)
  return ((data ?? []) as { tenant_id: string; reached: number; hard_bounces: number; complaints: number }[]).map(assess)
}

export const pct = (rate: number) => `${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}%`
