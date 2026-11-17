import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { CONTINUE_STALE_MS, sendEventEmail } from '@/lib/event-emails/send'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

export const maxDuration = 60

// POST /api/admin/events/[slug]/emails/[id]/send — "Send now", or with
// { test: true } a single copy to the person pressing the button, or with
// { continue: true } carry on a send that stopped at its time limit or was cut
// off ("Resume now"; the editor also calls it automatically). A continue only
// takes an email still 'sending' whose last heartbeat is CONTINUE_STALE_MS old,
// and skips everyone an earlier run already reached.
//
// Each request stops sending by SEND_DEADLINE_MS after it started, well inside
// maxDuration, and answers { incomplete: true, stoppedFor: 'time', remaining }.

const SEND_DEADLINE_MS = 50_000
//
// Stellr's sender, and its daily budget. Refused outside Stellr (refuseOutsideStellr: a
// tenant's staff get 503) until the tenant-filtered admin-records helpers exist
// (AMD-C17-HELPERS) and this route passes loadTenantSender's result to sendEventEmail.
// B14 did not lift the refusal.

const ROUTE = '/api/admin/events/[slug]/emails/[id]/send'

type Ctx = { params: Promise<{ slug: string; id: string }> }

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event_email.message.send', ...auditSubject(req, 'event_emails') }),
  sendEmail,
)

async function sendEmail(req: Request, { params }: Ctx) {
  const started = Date.now()
  const { slug, id } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug, id })
  const refused = refuseOutsideStellr(crew.scope)
  if (refused) return refused

  const db = supabaseServer()
  // Scope check before handing the id to the engine, which does not know the URL.
  const email = await loadEventRecord<{ id: string; event_slug: string }>(crew, 'event_emails', id, {
    db,
    select: 'id, event_slug',
    notFound: () => NextResponse.json({ error: 'Email not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!email.ok) return email.response

  const b = await req.json().catch(() => ({}))
  const test = b?.test === true
  const resume = !test && b?.continue === true
  noteAuditSubject(req, { detail: { test, ...(resume ? { continue: true } : {}) } })
  const actor = await actorFromAuth()
  let testTo: string | undefined
  if (test) {
    const u = await currentUser().catch(() => null)
    testTo = u?.primaryEmailAddress?.emailAddress ?? u?.emailAddresses?.[0]?.emailAddress
  }

  const out = await sendEventEmail(db, id, {
    trigger: test ? 'test' : 'manual',
    triggeredBy: actor.actorLabel ?? crew.userId,
    testTo,
    deadline: started + SEND_DEADLINE_MS,
    ...(resume ? { resume: true, staleMs: CONTINUE_STALE_MS } : {}),
  })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ ...out, testTo: testTo ?? null })
}
