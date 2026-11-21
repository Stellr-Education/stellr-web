import { auth } from '@clerk/nextjs/server'
import { isStellrAdmin } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { backfillMembershipAgreements } from '@/lib/membership-backfill'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// POST /api/admin/esign/membership-backfill — { dryRun?: boolean, limit?: number }
// Issues the Membership Agreement to existing members who have never signed
// one, a batch at a time. Dry run (the default) only counts.

export const maxDuration = 60

// Platform audit (docs/TENANCY-S5.md, C7): a dry run is recorded too, with counts only.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'esign.membership_backfill.run', ...adminAuditSubject(req, 'agreements') }),
  runBackfill,
)

async function runBackfill(req: Request) {
  const { userId } = await auth()
  if (!userId || !(await isStellrAdmin({ route: '/api/admin/esign/membership-backfill' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown; limit?: unknown }
  const dryRun = body.dryRun !== false
  const limit = Math.min(Math.max(1, Number(body.limit) || 25), 50)
  noteAuditSubject(req, { userId, detail: { dry_run: dryRun, limit } })
  const result = await backfillMembershipAgreements(supabaseServer(), { dryRun, limit })
  noteAuditSubject(req, { detail: { candidates: result.candidates, issued: result.issued } })
  if (!dryRun) console.info(`[membership-backfill] by ${userId}:`, JSON.stringify(result))
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
