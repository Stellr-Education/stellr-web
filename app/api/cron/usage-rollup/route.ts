import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { USAGE_FLAG, usageMeteringEnabled } from '@/lib/usage/record'
import { runUsageRollup } from '@/lib/usage/rollup'

// GET /api/cron/usage-rollup
// Vercel cron, daily (see vercel.json). S6-USE: rolls yesterday's and today's
// usage_events into usage_daily per tenant and kind, and purges raw rows older
// than 90 days (lib/usage/rollup.ts). Counts only, never personal data.
//
// Inert until USAGE_METERING_ENABLED is exactly 'true': with the flag off it
// answers { skipped } after the cron guard, before it creates a client, and
// writes nothing, cron_runs included. With it on, every run is recorded in
// cron_runs. Idempotent: a repeated run writes the same totals.
//
// One call per day rolled up, one delete: well inside 60 s.
export const maxDuration = 60

export const GET = withCronAudit('usage-rollup', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked
  if (!usageMeteringEnabled()) {
    return NextResponse.json({ skipped: true, reason: `${USAGE_FLAG} is off` })
  }

  const db = supabaseServer()
  const run = await startCronRun(db, 'usage-rollup')
  try {
    const result = await runUsageRollup(db, { now: new Date(), fail: (where, err) => run.fail(where, err) })
    await run.finish({ ...result })
    return NextResponse.json(result, { status: result.failures ? 500 : 200 })
  } catch (err) {
    run.fail('usage-rollup', err)
    await run.finish({})
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
