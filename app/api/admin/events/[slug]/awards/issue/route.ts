import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { getEventBySlug } from '@/lib/events/repo'
import { themeFromType } from '@/lib/campaigns'
import { issueAwards } from '@/lib/event-award-issue'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

// POST — issue the judged awards: every assignment becomes a credential the
// student can see and download; anything taken away since the last run is
// revoked. Safe to press again after a correction.
type Ctx = { params: Promise<{ slug: string }> }

// S5 wave 8, C19b: tenant_crew, and Stellr-only for other tenants. Each award is a credential
// Stellr Education issues (decision W7-9), so the handler asks stellrOnlyEvent right after the
// access check, as ../route.ts does. Stellr's own events answer as before.
const ROUTE = '/api/admin/events/[slug]/awards/issue'

// Platform audit (docs/TENANCY-S5.md, C7). The handler notes who passed requireEventRoute and
// the tenant it resolved; the event goes on that tenant's chain.

// The counts of the run are the metadata: no student's name or award reaches the event.
const issueAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.awards.issue' as const, ...auditSubject(req, 'credentials') })

export const POST = withAudit(issueAudit, issueEventAwards)

async function issueEventAwards(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const event = await getEventBySlug(slug)
  const eventTitle = (event as { title?: string } | null)?.title ?? slug
  // Same theme rule as participation credentials: the badge ring follows it.
  const theme = themeFromType((event as { type?: string } | null)?.type) === 'enviro' ? 'environmental' : 'space'

  const result = await issueAwards(stellrOnlyDb(crew.scope, supabaseServer()), slug, { eventTitle, theme })
  noteAuditSubject(req, {
    detail: {
      issued: result.issued,
      students: result.students,
      reinstated: result.reinstated,
      revoked: result.revoked,
      unchanged: result.unchanged,
      // Not 'emailed': the audit sanitiser drops any key containing 'email' (lib/audit/platform.ts).
      notified: result.emailed,
      skipped: result.skipped,
      failed: result.failures.length,
    },
  })
  return NextResponse.json({ ok: true, ...result })
}
