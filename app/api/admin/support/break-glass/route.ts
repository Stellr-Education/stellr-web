import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { assertPlatformAdmin, writeRefusal } from '@/lib/authz'
import { requireBreakGlassStepUp } from '@/lib/authz/step-up'
import {
  cookieValue,
  decodeSupportTicket,
  encodeSupportTicket,
  SUPPORT_SESSION_COOKIE,
  supportModeEnabled,
  supportSecretProblem,
} from '@/lib/authz/support-session'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation } from '@/lib/audit/route'
import { BREAK_GLASS_MINUTES, cleanBreakGlassReason, refusalOf, refusalResponse } from '@/lib/support/break-glass'
import { supabaseServer } from '@/lib/supabase'
import { requestTenant } from '@/lib/tenancy/request-tenant'

// S6-BG: break-glass (docs/S6-DESIGN.md section 3).
//
// POST { consentId, reason } opens a 30-minute break_glass support session on the
// consent's tenant and sets the signed support cookie. PATCH { reason } renews the
// caller's own live break-glass session once, by 30 minutes, to 60 at most. DELETE is
// the support session route's (../session): it closes a session of either mode.
//
// The four refusals the S6 gate names, each tested:
//   - no tenant consent: support_break_glass_open needs an approved, unused, unlapsed
//     request this admin made (403 break_glass_no_consent);
//   - no reason: 20 to 500 characters, here and in the database (400 break_glass_reason);
//   - no step-up: a sign-in factor confirmed in the last 5 minutes, whatever
//     ADMIN_STEP_UP_ENFORCE says (Clerk's reverification 403), on open and on renew;
//   - past the time limit: renew refuses an ended session (409 break_glass_ended), and
//     every admin write checks the cookie's end time (lib/authz/writable.ts).
//
// Also, as for read sessions: 404 when SUPPORT_MODE_ENABLED is off or on a tenant host
// (S6-Q7); platform admins only; refused (403 support_read_only) from inside a read
// session, which must be closed first; and nothing opens or renews unless the tenant's
// audit chain records it.

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/support/break-glass'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refuse(status: number, error: string, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge }
}

async function unavailable(): Promise<boolean> {
  if (!supportModeEnabled()) return true
  try {
    return (await requestTenant()).kind !== 'stellr'
  } catch {
    return true
  }
}

type Gate = { ok: true; userId: string; clerkSessionId: string } | { ok: false; response: Response }

/** The checks open and renew share, in order. */
async function gate(req: Request): Promise<Gate> {
  if (await unavailable()) return { ok: false, response: refuse(404, 'Not found') }
  const { userId, sessionId: clerkSessionId } = await auth()
  if (!userId || !(await assertPlatformAdmin({ route: ROUTE })).ok) return { ok: false, response: refuse(403, 'Forbidden') }
  // A read session, or one past its end time, is refused here; a live break-glass
  // session is not (renewing it is the point), so the opt-in is passed.
  const refused = writeRefusal(req, null, { breakGlass: true })
  if (refused) return { ok: false, response: refused }
  const stepUp = await requireBreakGlassStepUp()
  if (stepUp) return { ok: false, response: stepUp }
  if (!clerkSessionId) return { ok: false, response: refuse(403, 'Break-glass must be tied to a signed-in session.') }
  if (supportSecretProblem()) return { ok: false, response: refuse(503, 'Support mode is not configured on this deployment.') }
  if (!auditEnabled()) return { ok: false, response: refuse(503, 'Support mode needs the platform audit log (PLATFORM_AUDIT_ENABLED).') }
  return { ok: true, userId, clerkSessionId }
}

async function body(req: Request): Promise<Record<string, unknown>> {
  return ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
}

export async function POST(req: Request) {
  const g = await gate(req)
  if (!g.ok) return g.response
  const b = await body(req)
  if (typeof b.consentId !== 'string' || !UUID.test(b.consentId)) return refuse(400, 'consentId must be a request id')
  const reason = cleanBreakGlassReason(b.reason)
  if (!reason) return refusalResponse('break_glass_reason', 400)

  const db = supabaseServer()
  const { data, error } = await db.rpc('support_break_glass_open', { p_consent_id: b.consentId.toLowerCase(), p_admin: g.userId, p_reason: reason })
  if (error) {
    const code = refusalOf(error)
    if (code === 'break_glass_no_consent') return refusalResponse(code, 403)
    if (code === 'support_session_open') return refusalResponse(code, 409)
    if (code === 'break_glass_reason') return refusalResponse(code, 400)
    return refuse(503, 'Could not open break-glass.')
  }
  const row = (Array.isArray(data) ? data[0] : data) as { session_id: string; tenant_id: string; ends_at: string } | undefined
  if (!row) return refuse(503, 'Could not open break-glass.')
  const endsAt = Date.parse(row.ends_at)

  const audited = await auditMutation(
    {
      action: 'support.break_glass.open',
      actor: { userId: g.userId },
      tenant: { tenantId: row.tenant_id },
      target: { table: 'support_sessions', id: row.session_id },
      reason: 'break_glass',
      metadata: { mode: 'break_glass', minutes: BREAK_GLASS_MINUTES, consent: b.consentId.toLowerCase() },
    },
    { afterResponse: false },
  )
  if (!audited.ok) {
    // Break-glass the tenant cannot see on its audit page must not exist. The consent stays spent.
    await db.from('support_sessions').update({ closed_at: new Date().toISOString() }).eq('id', row.session_id)
    return refuse(503, 'Break-glass could not be recorded, so it was closed. Ask the tenant for a new approval.')
  }

  const ticket = encodeSupportTicket({ v: 1, sid: row.session_id, tid: row.tenant_id, uid: g.userId, csid: g.clerkSessionId, mode: 'break_glass', exp: endsAt })
  ;(await cookies()).set(SUPPORT_SESSION_COOKIE, ticket, cookieOptions(Math.max(1, Math.floor((endsAt - Date.now()) / 1000))))
  return NextResponse.json(
    { sessionId: row.session_id, tenantId: row.tenant_id, mode: 'break_glass', endsAt: new Date(endsAt).toISOString() },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function PATCH(req: Request) {
  const g = await gate(req)
  if (!g.ok) return g.response
  const jar = await cookies()
  // The same cookie writeRefusal read in gate(): the request's own.
  const ticket = decodeSupportTicket(cookieValue(req.headers.get('cookie'), SUPPORT_SESSION_COOKIE))
  if (!ticket || ticket.uid !== g.userId || ticket.csid !== g.clerkSessionId || ticket.mode !== 'break_glass') return refusalResponse('break_glass_ended', 409)
  const reason = cleanBreakGlassReason((await body(req)).reason)
  if (!reason) return refusalResponse('break_glass_reason', 400)

  const db = supabaseServer()
  const { data, error } = await db.rpc('support_break_glass_renew', { p_session_id: ticket.sid, p_admin: g.userId, p_reason: reason })
  if (error) {
    const code = refusalOf(error)
    if (code === 'break_glass_ended' || code === 'break_glass_renewed') return refusalResponse(code, 409)
    if (code === 'break_glass_reason') return refusalResponse(code, 400)
    return refuse(503, 'Could not renew break-glass.')
  }
  const endsAt = Date.parse(String(data))
  if (!Number.isFinite(endsAt)) return refuse(503, 'Could not renew break-glass.')

  const audited = await auditMutation(
    {
      action: 'support.break_glass.renew',
      actor: { userId: g.userId },
      tenant: { tenantId: ticket.tid },
      target: { table: 'support_sessions', id: ticket.sid },
      reason: 'break_glass',
      metadata: { mode: 'break_glass', ends_at: new Date(endsAt).toISOString() },
    },
    { afterResponse: false },
  )
  if (!audited.ok) {
    // An unrecorded renewal must not stand: close the session instead.
    await db.from('support_sessions').update({ closed_at: new Date().toISOString() }).eq('id', ticket.sid)
    jar.set(SUPPORT_SESSION_COOKIE, '', cookieOptions(0))
    return refuse(503, 'The renewal could not be recorded, so break-glass was closed.')
  }

  jar.set(
    SUPPORT_SESSION_COOKIE,
    encodeSupportTicket({ ...ticket, exp: endsAt }),
    cookieOptions(Math.max(1, Math.floor((endsAt - Date.now()) / 1000))),
  )
  return NextResponse.json({ sessionId: ticket.sid, tenantId: ticket.tid, mode: 'break_glass', endsAt: new Date(endsAt).toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
}
