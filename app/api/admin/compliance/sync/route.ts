import { NextResponse } from 'next/server'
import { isStellrAdmin } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { getBackgroundProvider } from '@/lib/background-provider'
import { syncStaleChecks } from '@/lib/background-sync'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// POST /api/admin/compliance/sync
// Admin-triggered version of the background-sync cron, with no age threshold:
// re-polls every open check right now. This is the recovery path when a
// webhook was missed, and the only path on the dev deployment (where the cron
// declines to run — see lib/cron.ts).
//
// Platform audit (docs/TENANCY-S5.md, C7): counts only. A provider that is not set up is
// a 503 and is recorded with its status.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'compliance.background_check.sync', ...adminAuditSubject(req, 'member_background_checks') }),
  syncNow,
)

async function syncNow(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/compliance/sync' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const provider = getBackgroundProvider()
  if (!provider.configured()) {
    return NextResponse.json(
      { error: `Background-check provider (${provider.name}) is not configured` },
      { status: 503 },
    )
  }

  const result = await syncStaleChecks(supabaseServer(), provider)
  noteAuditSubject(req, { detail: { scanned: result.scanned, updated: result.updated, unchanged: result.unchanged, errors: result.errors.length } })
  return NextResponse.json({ ok: true, ...result })
}
