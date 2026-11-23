// S6-USE: usage metering, counts only (docs/S6-DESIGN.md, S6-Q6).
//
// recordUsage() writes one public.usage_events row: a tenant, a kind and a count.
// Never a person, an address, an event key or any free text, so nothing written
// here can name anyone. The daily usage-rollup cron sums the rows into
// public.usage_daily (lib/usage/rollup.ts).
//
// Behind USAGE_METERING_ENABLED, exactly 'true', off by default. Off, recordUsage
// returns before it creates a client or schedules anything: the hot paths that
// call it (a registration, an event mirror write, every email send) pay one
// environment read. On, the insert runs after the response (runAfterResponse),
// and a failed insert is logged and swallowed: usage is best-effort and never
// fails or slows the request that caused it.
//
// The write points (one each):
//   registration  the registration routes' finally block, once a registration
//                 was created and the answer is 2xx (app/api/register/*/route.ts)
//   event         upsertEventRows, for a mirror row that did not exist before
//                 (lib/events/sync.ts)
//   email         a send Resend accepted: sendEmail (lib/email.ts) and the
//                 outbox drain (lib/email/outbox.ts)
//   identity      none: members rows are created in many places, so
//                 usage_rollup() counts new members rows in SQL instead

import { runAfterResponse } from '@/lib/after-response'
import { supabaseServer } from '@/lib/supabase'

export const USAGE_FLAG = 'USAGE_METERING_ENABLED'

/** The kinds the usage_events CHECK allows (migration 20261123023107_usage_events). */
export const USAGE_KINDS = ['registration', 'event', 'email', 'identity'] as const
export type UsageKind = (typeof USAGE_KINDS)[number]

export function usageMeteringEnabled(): boolean {
  return process.env[USAGE_FLAG] === 'true'
}

/**
 * Count `count` of `kind` for `tenantId`, after the response. A no-op with the flag
 * off, with no tenant, or with a count that is not a positive integer. Never throws.
 */
export function recordUsage(tenantId: string | null | undefined, kind: UsageKind, count = 1): void {
  if (!usageMeteringEnabled()) return
  if (!tenantId || !Number.isInteger(count) || count <= 0) return
  runAfterResponse('usage', async () => {
    const { error } = await supabaseServer().from('usage_events').insert({ tenant_id: tenantId, kind, count })
    if (error) throw new Error(`usage_events insert failed: ${error.message}`)
  })
}
