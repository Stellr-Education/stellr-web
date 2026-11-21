import { auth } from '@clerk/nextjs/server'
import { isStellrAdmin } from '@/lib/authz'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron-runs'
import { ALL_STEPS, runEsignMaintenance, type MaintenanceStep } from '@/lib/esign/maintenance'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// POST /api/admin/esign/maintenance — run the daily signed-record housekeeping
// now: sync DocuSign's allowance figures, archive signed PDFs not yet stored
// here (this is also the backfill for agreements signed before archiving
// existed), and delete records past their retention date.
//
// The daily cron only runs in production; this is how the same code is
// exercised on dev, and how an admin catches up without waiting a day.
// `dryRun` reports what would be done and changes nothing.

export const maxDuration = 60

/**
 * Off-site copying stops starting new records this long into the run, leaving
 * room for the one in flight and the steps after it inside maxDuration.
 */
const COPY_BUDGET_MS = 35_000

const bodySchema = z.object({
  dryRun: z.boolean().optional(),
  steps: z.array(z.enum(ALL_STEPS as [MaintenanceStep, ...MaintenanceStep[]])).optional(),
}).strict()

// Platform audit (docs/TENANCY-S5.md, C7): who ran it, whether it was a dry run, and
// which steps. What each step did stays in the cron run ledger.
export const POST = withAudit(
  ({ args: [req] }: { args: [NextRequest] }) => ({ action: 'esign.maintenance.run', ...adminAuditSubject(req, 'cron_runs') }),
  runMaintenance,
)

async function runMaintenance(req: NextRequest) {
  const { userId } = await auth()
  if (!userId || !(await isStellrAdmin({ route: '/api/admin/esign/maintenance' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  noteAuditSubject(req, { userId, detail: { dry_run: Boolean(parsed.data.dryRun), steps: parsed.data.steps ?? ['all'] } })

  const deadline = Date.now() + COPY_BUDGET_MS
  const db = supabaseServer()
  const run = await startCronRun(db, 'esign-maintenance-manual')
  const result = await runEsignMaintenance(db, {
    ...parsed.data,
    deadline,
    onError: (step, err) => run.fail(step, err),
  })
  await run.finish({ ...result, by: userId })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
