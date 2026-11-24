import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { checkTenantReputation } from '@/lib/email/reputation-alert'

// GET /api/cron/email-reputation
// Vercel cron, daily (see vercel.json). Email plan E: alerts staff about any
// tenant whose last 7 days of mail drew complaints or hard bounces above the alert
// lines (lib/email/reputation.ts), once a week per tenant. Pauses nothing.
export const maxDuration = 60

export const GET = withCronAudit('email-reputation', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'email-reputation')
  try {
    const result = await checkTenantReputation(db, new Date())
    await run.finish({ checked: result.checked, concerning: result.concerning, alerted: result.alerted.length })
    return NextResponse.json({ checked: result.checked, concerning: result.concerning, alerted: result.alerted.length })
  } catch (err) {
    run.fail('check', err)
    await run.finish({})
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
