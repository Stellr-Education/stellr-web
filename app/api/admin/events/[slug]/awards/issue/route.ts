import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getEventBySlug } from '@/lib/events/repo'
import { themeFromType } from '@/lib/campaigns'
import { issueAwards } from '@/lib/event-award-issue'
import { withAudit, type AuditMutation } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

// POST — issue the judged awards: every assignment becomes a credential the
// student can see and download; anything taken away since the last run is
// revoked. Safe to press again after a correction.
type Ctx = { params: Promise<{ slug: string }> }

// Platform audit (docs/TENANCY-S5.md, C7). The handler notes who passed requireEventAccess;
// the event goes on the chain of the event's owner, read from the mirror by its slug.
/** The event in the URL, /api/admin/events/<slug>/…: only looked up, never stored from here. */
function eventSlugOf(req: Request): string {
  const parts = new URL(req.url).pathname.split('/')
  const at = parts.indexOf('events')
  return at < 0 ? '' : (parts[at + 1] ?? '')
}
function eventAudit(req: Request, table: string): Omit<AuditMutation, 'action'> {
  return { ...auditSubject(req, table), tenant: { eventSlug: eventSlugOf(req) } }
}

// The counts of the run are the metadata: no student's name or award reaches the event.
const issueAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.awards.issue' as const, ...eventAudit(req, 'credentials') })

export const POST = withAudit(issueAudit, issueEventAwards)

async function issueEventAwards(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  noteAuditSubject(req, { userId: access.userId, eventSlug: slug })

  const event = await getEventBySlug(slug)
  const eventTitle = (event as { title?: string } | null)?.title ?? slug
  // Same theme rule as participation credentials: the badge ring follows it.
  const theme = themeFromType((event as { type?: string } | null)?.type) === 'enviro' ? 'environmental' : 'space'

  const result = await issueAwards(supabaseServer(), slug, { eventTitle, theme })
  noteAuditSubject(req, {
    detail: {
      issued: result.issued,
      students: result.students,
      reinstated: result.reinstated,
      revoked: result.revoked,
      unchanged: result.unchanged,
      emailed: result.emailed,
      skipped: result.skipped,
      failed: result.failures.length,
    },
  })
  return NextResponse.json({ ok: true, ...result })
}
