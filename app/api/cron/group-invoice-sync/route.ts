import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { runPerTenant, type TenantJob } from '@/lib/cron-tenants'
import { getEventBySlugIn } from '@/lib/events/tenant-facade'
import { syncAddonInvoice } from '@/lib/addons/invoice'
import { sweepUnpaidAddons } from '@/lib/addons/sweep'
import { settleDueShares, syncDueGroupInvoices } from '@/lib/billing-sweeps'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// GET /api/cron/group-invoice-sync — runs daily (see vercel.json).
//
// After a roster change, the function that handled it waits out a quiet period
// and then updates the group's unpaid invoice. If that function is cut off, or
// Stripe refuses, the update stays due. This is the backstop that runs it.
//
// It also settles groups whose students share the teacher's cost, the day after
// their event (lib/teacher-share.ts): one daily job rather than a new cron.
//
// Per tenant (S5 B22): both passes read tenant_id with their rows and run through
// runPerTenant (lib/cron-tenants.ts). Only Stellr runs. Stellr alone is the
// runner's plain call: no read of `tenants`, the same Stripe calls and writes,
// and the same result keys, with failures under the same labels. Every other
// tenant's due rows are held until S9 brings priced tenant events (A7 refuses
// them until then): they never reach Stripe, stay due for a later run, and are
// counted in `tenantHeld` and `share_tenantHeld`. Tenant comes from the rows
// only, never from a request header or host.
//
// Stellr's reads take Stellr's rows (NULL counts as Stellr), so a backlog of held
// rows can never fill the 50 a pass takes and starve Stellr's.
//
// Both passes are the lib sweeps, syncDueGroupInvoices and settleDueShares
// (lib/billing-sweeps.ts), given the job's tenant, the deadline and
// the abort check. test/cron-per-tenant-b22.test.ts proves the Stripe calls and
// writes match the sweeps' unscoped run on a Stellr fixture. The held counts are
// head counts: no held row is fetched.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Rows each pass takes per run, as before. */
const PASS_LIMIT = 50

/** Stop starting registrations this long into the run, clear of maxDuration (300 s). */
const RUN_BUDGET_MS = 270_000

type Db = SupabaseClient
type Pass = Record<string, number>

/** Registrations of another tenant (never NULL, which is Stellr's) whose invoice update is due, counted only. */
const invoiceSyncHeld = (db: Db) =>
  db.from('registrations').select('id', { count: 'exact', head: true })
    .not('invoice_sync_due_at', 'is', null).lte('invoice_sync_due_at', new Date().toISOString())
    .not('tenant_id', 'is', null).neq('tenant_id', STELLR_TENANT_ID)

/** Registrations of another tenant whose shared cost is still to settle, counted only. */
const shareHeld = (db: Db) =>
  db.from('registrations').select('id', { count: 'exact', head: true })
    .not('share_estimate', 'is', null).is('share_settled_at', null).neq('status', 'withdrawn')
    .not('tenant_id', 'is', null).neq('tenant_id', STELLR_TENANT_ID)

/** Unpaid group invoices whose update is due, for one tenant, then any add-ons on each invoice. */
function syncDue(db: Db, stripe: Stripe, job: TenantJob, stop: () => boolean): Promise<Pass> {
  return syncDueGroupInvoices(db, stripe, {
    limit: PASS_LIMIT,
    tenantId: job.tenant.id,
    stop,
    // Add-ons on the group's invoice (lib/addons/invoice.ts): an update that found the invoice busy.
    after: async (id, tally) => {
      const { count } = await db.from('registration_addons').select('id', { count: 'exact', head: true })
        .eq('registration_id', id).eq('payer', 'group').eq('group_method', 'invoice').eq('status', 'pending_payment')
      if (!count) return
      const addons = await syncAddonInvoice(db, stripe, id, { memberId: null, label: 'add-on change' })
      tally[`addons_${addons}`] = (tally[`addons_${addons}`] ?? 0) + 1
    },
  })
}

/** Sharing groups whose event is over, for one tenant, its events read through that tenant (C8-PG). */
function settleDue(db: Db, stripe: Stripe, job: TenantJob, stop: () => boolean): Promise<Pass> {
  return settleDueShares(db, stripe, {
    limit: PASS_LIMIT,
    tenantId: job.tenant.id,
    stop,
    readEvent: (slug) => getEventBySlugIn(job.tenant.id, slug),
  })
}

/**
 * How many due rows other tenants have waiting. A failed read is recorded and
 * counts none, so Stellr's result still lands (PR701-1: kept as built).
 */
async function heldCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  fail: (detail: string) => void,
): Promise<number> {
  const { count, error } = await query
  if (error) {
    fail(error.message)
    return 0
  }
  return count ?? 0
}

export const GET = withCronAudit('group-invoice-sync', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured here' }, { status: 503 })

  const started = Date.now()
  const db = supabaseServer()
  const run = await startCronRun(db, 'group-invoice-sync')
  try {
    // Only Stellr runs until S9. It always has a turn, so a quiet run still
    // writes the share tally it always has.
    const tenantIds = [STELLR_TENANT_ID]
    const stellrOnly = tenantIds.length === 1
    const stellrFailure: unknown[] = []
    const outcome = await runPerTenant<{ tally: Pass; shares: Pass }>(db, run, {
      job: 'group-invoice-sync',
      deadline: started + RUN_BUDGET_MS,
      tenantIds,
      fn: async (job) => {
        const stop = () => job.signal.aborted || Date.now() > job.deadline
        let tally: Pass
        try {
          tally = await syncDue(db, stripe, job, stop)
        } catch (err) {
          // Stellr alone: a failed sweep ends the run as it always has (the 500
          // below), rather than becoming a recorded tenant failure.
          if (!stellrOnly) throw err
          stellrFailure.push(err)
          return { tally: {}, shares: {} }
        }
        let shares: Pass = {}
        try {
          shares = await settleDue(db, stripe, job, stop)
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          console.error('[cron:group-invoice-sync] share settlement failed:', detail)
          job.fail('share-settle', detail)
        }
        // Event add-ons (lib/addons/sweep.ts): unpaid places released at their cut-off,
        // and a reminder the week before. Counted only when there is something to count.
        try {
          const addons = await sweepUnpaidAddons(db, stripe)
          if (addons.released) tally.addons_released = addons.released
          if (addons.reminded) tally.addons_reminded = addons.reminded
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          console.error('[cron:group-invoice-sync] add-on sweep failed:', detail)
          job.fail('addon-sweep', detail)
        }
        return { tally, shares }
      },
    })
    if (stellrFailure.length) throw stellrFailure[0]

    const { tally, shares } = outcome.results.get(STELLR_TENANT_ID) ?? { tally: {}, shares: {} }
    const heldFailed = (where: string) => (detail: string) => {
      console.error(`[cron:group-invoice-sync] ${where} read failed:`, detail)
      run.fail(where, detail)
    }
    const tenantHeld = await heldCount(invoiceSyncHeld(db), heldFailed('tenant-held'))
    const shareTenantHeld = await heldCount(shareHeld(db), heldFailed('share-tenant-held'))

    // tenantHeld, share_tenantHeld and the ledger are absent from a Stellr-only run with nothing held.
    const all = {
      ...tally,
      ...Object.fromEntries(Object.entries(shares).map(([k, v]) => [`share_${k}`, v])),
      ...(tenantHeld ? { tenantHeld } : {}),
      ...(shareTenantHeld ? { share_tenantHeld: shareTenantHeld } : {}),
      ...outcome.ledger,
    }
    await run.finish(all)
    return NextResponse.json(all)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[cron:group-invoice-sync] failed:', detail)
    run.fail('sync', detail)
    await run.finish({})
    return NextResponse.json({ error: detail }, { status: 500 })
  }
})
