import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { EMAIL_EVENTS_RETENTION_MONTHS, pruneEmailEvents } from '@/lib/email/events'

// GET /api/cron/email-events-retention
// Vercel cron, monthly (see vercel.json). Deletes email_events rows more than
// 13 months old (retention schedule row 37; lib/email/events.ts). Every run, and
// every failure, is recorded in cron_runs. One delete: well inside 60 s.
export const maxDuration = 60

export const GET = withCronAudit('email-events-retention', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'email-events-retention')
  try {
    const result = await pruneEmailEvents(db, new Date())
    await run.finish({ retentionMonths: EMAIL_EVENTS_RETENTION_MONTHS, ...result })
    return NextResponse.json(result)
  } catch (err) {
    run.fail('prune', err)
    await run.finish({ retentionMonths: EMAIL_EVENTS_RETENTION_MONTHS })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
})
