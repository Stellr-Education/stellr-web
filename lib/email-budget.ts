// Shared daily Resend send budget (deep review INT-2 / PUB-4).
//
// Resend's plan limits (Free: 100 a day and 3,000 a month; Pro: no daily cap and
// 50,000 a month) are shared by every sender Stellr has. lib/rate-limit.ts is per-warm-serverless-instance, so it cannot enforce
// a cap shared across instances, and the per-feature budgets (esign 60/day in
// lib/esign/outbox.ts, survey 30/day in lib/survey/send.ts) each guard only
// their own channel. This module is the ONE global, durable, cross-instance
// counter — a single `email_send_quota` row per UTC day in Supabase — that
// lib/email.ts increments on every successful Resend send, whatever the sender.
// The monthly check sums those day rows from the start of the billing month.
//
// On top of the counter it enforces a TRANSACTIONAL RESERVE: the last
// `transactionalReserve()` sends of the day are usable only by transactional
// mail (consent / credential / registration / safeguarding). Marketing/bulk
// mail (campaigns, event-email blasts) is refused once the non-reserved budget
// is spent, so a burst of bulk mail can never drain the day's last sends that a
// minor's consent email needs.
//
// Tenants (S5 B14; owner decision, 9 Nov 2026): ONE SHARED POOL until the move to
// SES. A tenant's event mail goes through sendEmail() like Stellr's, so it is
// counted here on the same row and held to the same caps. There is no per-tenant
// allowance and no tenant argument: the reserve keeps bulk mail out, not any one
// sender. The accepted risk is that one busy tenant can reach Resend's own daily
// limit, after which Resend refuses mail for every sender, Stellr included.

import type { SupabaseClient } from '@supabase/supabase-js'

/** How a send is weighed against the shared budget. */
export type EmailKind = 'transactional' | 'marketing'

// Resend Free is 100/day and 3,000/month; keep a fifth of the day for
// transactional mail. Every limit is overridable so the caps follow a plan change
// without a deploy (Resend Pro, nonprofit pricing, Nov 2026: set
// EMAIL_DAILY_CAP=none and EMAIL_MONTHLY_CAP=50000), and so tests can shrink them.
const DEFAULT_DAILY_CAP = 100
const DEFAULT_TRANSACTIONAL_RESERVE = 20
const DEFAULT_MONTHLY_CAP = 3000
/** Share of the month kept for transactional mail when no explicit reserve is set. */
const DEFAULT_MONTHLY_RESERVE_SHARE = 0.1

/** "none", "off" or "0" mean the plan has no such cap. Anything unparseable keeps the default. */
function capFromEnv(raw: string | undefined, fallback: number): number | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'none' || v === 'off' || v === '0') return null
  const n = Number(v)
  return v !== '' && Number.isInteger(n) && n > 0 ? n : fallback
}

/** The plan's daily cap, or null when the plan has none (Resend Pro and up). */
export function dailyCap(): number | null {
  return capFromEnv(process.env.EMAIL_DAILY_CAP, DEFAULT_DAILY_CAP)
}

/**
 * Sends at the top of the day's budget that only transactional mail may use.
 * Clamped to [0, cap - 1] so marketing always keeps at least one slot and the
 * reserve can never swallow the whole cap. 0 when there is no daily cap.
 */
export function transactionalReserve(): number {
  const cap = dailyCap()
  if (cap === null) return 0
  const raw = Number(process.env.EMAIL_TRANSACTIONAL_RESERVE)
  const reserve = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_TRANSACTIONAL_RESERVE
  return Math.min(reserve, cap - 1)
}

/** The non-reserved portion of the day's budget — all that marketing may use. Null: no daily limit. */
export function marketingCap(): number | null {
  const cap = dailyCap()
  return cap === null ? null : cap - transactionalReserve()
}

/** The plan's monthly volume (Resend Pro: 50,000), or null for no monthly limit. */
export function monthlyCap(): number | null {
  return capFromEnv(process.env.EMAIL_MONTHLY_CAP, DEFAULT_MONTHLY_CAP)
}

/**
 * Sends at the top of the billing month that only transactional mail may use, so
 * a large community send can never push consent or registration mail into
 * Resend's overage (Pro bills $0.90 per extra 1,000) or, on Free, into refusal.
 */
export function monthlyTransactionalReserve(): number {
  const cap = monthlyCap()
  if (cap === null) return 0
  const raw = Number(process.env.EMAIL_MONTHLY_TRANSACTIONAL_RESERVE)
  const reserve = Number.isInteger(raw) && raw >= 0 ? raw : Math.round(cap * DEFAULT_MONTHLY_RESERVE_SHARE)
  return Math.min(reserve, cap - 1)
}

/** What marketing may use of the billing month. Null: no monthly limit. */
export function monthlyMarketingCap(): number | null {
  const cap = monthlyCap()
  return cap === null ? null : cap - monthlyTransactionalReserve()
}

/**
 * First UTC day of the current Resend billing month. Resend's month runs from the
 * subscription date, not the calendar month, so EMAIL_BILLING_DAY (1–28, default 1)
 * moves the boundary to match the dashboard.
 */
export function billingPeriodStart(now = new Date()): string {
  const raw = Number(process.env.EMAIL_BILLING_DAY)
  const day = Number.isInteger(raw) && raw >= 1 && raw <= 28 ? raw : 1
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth()
  if (now.getUTCDate() < day) {
    m -= 1
    if (m < 0) { m = 11; y -= 1 }
  }
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10)
}

export const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10)

/**
 * May a send of this `kind` go out right now against today's shared budget?
 *
 * Transactional mail is NEVER blocked here: the counter is advisory for it and
 * Resend's own plan limit is the hard ceiling, so a counter that is unreadable or
 * wrong can never cause a false quota block on a consent / credential /
 * registration / safeguarding email. This is the deliberate fail-SAFE choice —
 * we would rather send one consent email over the nominal cap (Resend may still
 * reject it) than silently drop it on a bad count.
 *
 * Marketing/bulk mail is refused once the day's (when the plan has a daily cap)
 * or the billing month's non-reserved budget is spent, protecting the reserve. The read failing is therefore only consequential for
 * marketing, where we fail CLOSED (refuse): without a trustworthy count we must
 * not risk the reserve, and a refused marketing send is deferred — the sender's
 * ledger retries it on the next run — not lost.
 */
export async function canSend(kind: EmailKind, db: SupabaseClient, now = new Date()): Promise<boolean> {
  if (kind === 'transactional') return true

  const dayCap = marketingCap()
  if (dayCap !== null) {
    const { data, error } = await db
      .from('email_send_quota')
      .select('sent')
      .eq('day', utcDay(now))
      .maybeSingle()
    if (error) {
      console.error('[email-budget] quota read failed — refusing marketing send (fail-closed):', error.message)
      return false
    }
    const sent = (data?.sent as number | undefined) ?? 0
    if (sent >= dayCap) return false
  }

  const monthCap = monthlyMarketingCap()
  if (monthCap !== null) {
    const { data, error } = await db
      .from('email_send_quota')
      .select('sent')
      .gte('day', billingPeriodStart(now))
    if (error) {
      console.error('[email-budget] monthly quota read failed — refusing marketing send (fail-closed):', error.message)
      return false
    }
    const sent = ((data ?? []) as { sent: number }[]).reduce((sum, r) => sum + (r.sent ?? 0), 0)
    if (sent >= monthCap) return false
  }
  return true
}

/**
 * Count one actually-sent email against today's shared budget. Best-effort and
 * atomic (bump_email_quota is a single INSERT … ON CONFLICT DO UPDATE): a
 * failure is logged, never thrown, because the mail has already gone out and
 * under-counting only ever errs toward letting more mail through.
 */
export async function recordSend(db: SupabaseClient, now = new Date()): Promise<void> {
  const { error } = await db.rpc('bump_email_quota', { p_day: utcDay(now) })
  if (error) console.error('[email-budget] quota increment failed:', error.message)
}
