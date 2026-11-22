import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventBySlug } from '@/lib/events/repo'
import { syncGroupInvoice } from '@/lib/group-billing'
import { eventIsOver, settleShare } from '@/lib/teacher-share'
import type { RegistrationRow } from '@/lib/database.types'
import { rowsOfTenant, tenantRowsOr } from '@/lib/tenancy/stellr-scope'

// The two daily due-row sweeps that app/api/cron/group-invoice-sync runs (S5 B22):
// group invoices whose update is due, and sharing groups whose event is over.
// They live apart from lib/group-billing.ts and lib/teacher-share.ts so the
// per-registration work they call is each module's export, which a test can
// stand in for (test/integration/two-tenant/crons.int.test.ts).

type Db = SupabaseClient

/**
 * How a due-row sweep runs. With no options it is the daily backstop as it was
 * before S5 B22: every due row, 50 at most. The per-tenant cron
 * (app/api/cron/group-invoice-sync) passes its tenant, its stop check and its
 * add-on step.
 */
export interface DueSweepOptions {
  /** Rows the read takes. */
  limit?: number
  /** Only this tenant's rows (NULL counts as Stellr's); another tenant's row is left alone. */
  tenantId?: string
  /** Checked before each registration: true leaves it for the next run, counted as `deferred`. */
  stop?: () => boolean
  /** Runs after each registration's update, and may add to the tally. */
  after?: (registrationId: string, tally: Record<string, number>) => Promise<void>
}

/** The daily backstop: settles every update whose waiting function never finished. */
export async function syncDueGroupInvoices(db: Db, stripe: Stripe, opts: DueSweepOptions = {}): Promise<Record<string, number>> {
  const { limit = 50, tenantId, stop, after } = opts
  let query = db.from('registrations')
    .select(tenantId ? 'id, tenant_id' : 'id')
    .not('invoice_sync_due_at', 'is', null)
    .lte('invoice_sync_due_at', new Date().toISOString())
  if (tenantId) query = query.or(tenantRowsOr(tenantId))
  const { data, error } = await query.limit(limit)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as { id: string; tenant_id: string | null }[]
  const tally: Record<string, number> = {}
  for (const { id } of tenantId ? rowsOfTenant(rows, tenantId) : rows) {
    if (stop?.()) {
      tally.deferred = (tally.deferred ?? 0) + 1
      continue
    }
    const result = await syncGroupInvoice(db, stripe, id)
    tally[result] = (tally[result] ?? 0) + 1
    await after?.(id, tally)
  }
  return tally
}

/**
 * The daily sweep: settles every sharing group whose event is over. Options as
 * syncDueGroupInvoices takes them (lib/group-billing.ts), with `readEvent`: the
 * per-tenant cron reads its tenant's events (S5 wave 8, C8-PG). Unset, Stellr's
 * Sanity read.
 */
export async function settleDueShares(
  db: Db,
  stripe: Stripe,
  opts: Omit<DueSweepOptions, 'after'> & { readEvent?: (slug: string) => Promise<unknown> } = {},
): Promise<Record<string, number>> {
  const { limit = 50, tenantId, stop, readEvent = getEventBySlug } = opts
  let query = db.from('registrations')
    .select(tenantId ? 'id, event_slug, tenant_id' : 'id, event_slug')
    .not('share_estimate', 'is', null)
    .is('share_settled_at', null)
    .neq('status', 'withdrawn')
  if (tenantId) query = query.or(tenantRowsOr(tenantId))
  const { data, error } = await query.limit(limit)
  if (error) throw new Error(error.message)
  const tally: Record<string, number> = { settled: 0, not_due: 0, refunds: 0, refunds_failed: 0 }
  const events = new Map<string, boolean>()
  const rows = (data ?? []) as unknown as (Pick<RegistrationRow, 'id' | 'event_slug'> & { tenant_id: string | null })[]
  for (const row of tenantId ? rowsOfTenant(rows, tenantId) : rows) {
    if (stop?.()) {
      tally.deferred = (tally.deferred ?? 0) + 1
      continue
    }
    if (!events.has(row.event_slug)) {
      const event = (await readEvent(row.event_slug).catch(() => null)) as { date?: string; endDate?: string } | null
      events.set(row.event_slug, eventIsOver(event))
    }
    if (!events.get(row.event_slug)) { tally.not_due++; continue }
    const out = await settleShare(db, stripe, row.id)
    if (!out) continue
    tally.settled++
    tally.refunds += out.refunded
    tally.refunds_failed += out.failed
  }
  return tally
}
