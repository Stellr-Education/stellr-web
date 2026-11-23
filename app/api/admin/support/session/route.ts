import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { assertPlatformAdmin, writeRefusal } from '@/lib/authz'
import { requireStepUp } from '@/lib/authz/step-up'
import {
  decodeSupportTicket,
  encodeSupportTicket,
  SUPPORT_SESSION_COOKIE,
  SUPPORT_SESSION_MAX_MINUTES,
  supportModeEnabled,
  supportSecretProblem,
} from '@/lib/authz/support-session'
import { auditEnabled } from '@/lib/audit/platform'
import { auditMutation } from '@/lib/audit/route'
import { supabaseServer } from '@/lib/supabase'
import { requestTenant } from '@/lib/tenancy/request-tenant'

// S6 support sessions (S6-SUP, docs/S6-DESIGN.md section 2).
//
// POST { tenantId, reason, minutes? } opens a read-only session on one non-owner tenant
// for `minutes` (default 30, at most 60) and sets the signed support cookie. DELETE ends
// the caller's session and clears the cookie.
//
// Every check fails closed:
//   - SUPPORT_MODE_ENABLED off: 404, as if the route did not exist;
//   - a tenant host: 404. Support mode runs on the platform host only (S6-Q7);
//   - POST needs a platform admin (assertPlatformAdmin, S6-Q3) who is also a
//     platform_admins row, and a fresh sign-in factor when ADMIN_STEP_UP_ENFORCE is on;
//   - POST is refused (403 support_read_only) while a read session is already open;
//   - the session is written to the TENANT's audit chain (platform_audit_events), and
//     does not open unless that row is written: with PLATFORM_AUDIT_ENABLED off, or a
//     failed write, POST answers 503 and the row is closed again. The free-text reason
//     stays in support_sessions; the chain gets a fixed code (it can never be erased).
//
// DELETE is never refused for a read session (ending one only reduces access:
// test/assert-writable-guard.test.ts WRITABLE_EXEMPTIONS). It closes only the caller's
// own session, named by their own valid cookie.

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/support/session'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_MINUTES = 30
const REASON_MIN = 20
const REASON_MAX = 500

function refuse(status: number, error: string, code?: string) {
  return NextResponse.json(code ? { error, code } : { error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

const notFound = () => refuse(404, 'Not found')

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge }
}

/** Off, or not the platform host: the route does not exist here. */
async function unavailable(): Promise<boolean> {
  if (!supportModeEnabled()) return true
  try {
    return (await requestTenant()).kind !== 'stellr'
  } catch {
    return true
  }
}

interface OpenBody {
  tenantId: string
  reason: string
  minutes: number
}

/** The request body, or the reason it is refused. */
function parseBody(body: unknown): OpenBody | string {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.tenantId !== 'string' || !UUID.test(b.tenantId)) return 'tenantId must be a tenant id'
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return `reason must be ${REASON_MIN} to ${REASON_MAX} characters`
  if (b.mode !== undefined && b.mode !== 'read') return 'only read sessions can be opened'
  const minutes = b.minutes === undefined ? DEFAULT_MINUTES : b.minutes
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > SUPPORT_SESSION_MAX_MINUTES) {
    return `minutes must be a whole number from 1 to ${SUPPORT_SESSION_MAX_MINUTES}`
  }
  return { tenantId: b.tenantId.toLowerCase(), reason, minutes }
}

export async function POST(req: Request) {
  if (await unavailable()) return notFound()
  const { userId, sessionId: clerkSessionId } = await auth()
  if (!userId || !(await assertPlatformAdmin({ route: ROUTE })).ok) return refuse(403, 'Forbidden')
  // Not withAudit: the tenant is known only from the body. So the support-read refusal is here.
  const readOnly = writeRefusal(req)
  if (readOnly) return readOnly
  const stepUp = await requireStepUp()
  if (stepUp) return stepUp
  if (!clerkSessionId) return refuse(403, 'A support session must be tied to a signed-in session.')
  if (supportSecretProblem()) return refuse(503, 'Support mode is not configured on this deployment.')
  if (!auditEnabled()) return refuse(503, 'Support mode needs the platform audit log (PLATFORM_AUDIT_ENABLED).')

  const parsed = parseBody(await req.json().catch(() => null))
  if (typeof parsed === 'string') return refuse(400, parsed)

  const db = supabaseServer()
  const { data: admin, error: adminError } = await db.from('platform_admins').select('clerk_user_id').eq('clerk_user_id', userId).maybeSingle()
  if (adminError) return refuse(503, 'Could not confirm your platform admin record.')
  if (!admin) return refuse(403, 'Support sessions are for platform admins only.')

  const { data: tenant, error: tenantError } = await db
    .from('tenants')
    .select('id, display_name, is_platform_owner')
    .eq('id', parsed.tenantId)
    .maybeSingle()
  if (tenantError) return refuse(503, 'Could not load the tenant.')
  if (!tenant) return refuse(404, 'Tenant not found')
  const t = tenant as { id: string; display_name: string; is_platform_owner: boolean }
  if (t.is_platform_owner) return refuse(403, 'Support mode is for other tenants. Use the ordinary admin screens for this one.', 'support_owner_tenant')

  // One live session per admin. One that has run out but was never closed is closed at its end.
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const { data: open, error: openError } = await db
    .from('support_sessions')
    .select('id, ends_at')
    .eq('platform_admin_user_id', userId)
    .is('closed_at', null)
  if (openError) return refuse(503, 'Could not check for an open support session.')
  for (const row of (open ?? []) as { id: string; ends_at: string }[]) {
    if (Date.parse(row.ends_at) > now) return refuse(409, 'Close your current support session first.')
    await db.from('support_sessions').update({ closed_at: row.ends_at }).eq('id', row.id).is('closed_at', null)
  }

  const endsAt = now + parsed.minutes * 60_000
  const { data: created, error: createError } = await db
    .from('support_sessions')
    .insert({
      platform_admin_user_id: userId,
      tenant_id: t.id,
      reason: parsed.reason,
      mode: 'read',
      opened_at: nowIso,
      ends_at: new Date(endsAt).toISOString(),
    })
    .select('id')
    .single()
  if (createError || !created) return refuse(503, 'Could not open the support session.')
  const sessionRowId = (created as { id: string }).id

  const audited = await auditMutation(
    {
      action: 'support.session.open',
      actor: { userId },
      tenant: { tenantId: t.id },
      target: { table: 'support_sessions', id: sessionRowId },
      reason: 'support_session',
      metadata: { mode: 'read', minutes: parsed.minutes },
    },
    { afterResponse: false },
  )
  if (!audited.ok) {
    // A session the tenant cannot see on its audit page must not exist.
    await db.from('support_sessions').update({ closed_at: new Date().toISOString() }).eq('id', sessionRowId)
    return refuse(503, 'The support session could not be recorded, so it was not opened. Try again.')
  }

  const ticket = encodeSupportTicket({ v: 1, sid: sessionRowId, tid: t.id, uid: userId, csid: clerkSessionId, mode: 'read', exp: endsAt })
  ;(await cookies()).set(SUPPORT_SESSION_COOKIE, ticket, cookieOptions(parsed.minutes * 60))
  return NextResponse.json(
    { sessionId: sessionRowId, tenantId: t.id, tenantName: t.display_name, mode: 'read', endsAt: new Date(endsAt).toISOString() },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function DELETE() {
  if (await unavailable()) return notFound()
  const { userId } = await auth()
  if (!userId) return refuse(401, 'Unauthorised')
  const jar = await cookies()
  const ticket = decodeSupportTicket(jar.get(SUPPORT_SESSION_COOKIE)?.value)
  jar.set(SUPPORT_SESSION_COOKIE, '', cookieOptions(0))
  if (!ticket || ticket.uid !== userId) return NextResponse.json({ closed: false }, { headers: { 'Cache-Control': 'no-store' } })

  const { data: closed, error } = await supabaseServer()
    .from('support_sessions')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', ticket.sid)
    .eq('platform_admin_user_id', userId)
    .is('closed_at', null)
    .select('id, tenant_id')
  if (error) return refuse(503, 'The cookie was cleared, but the session could not be closed. It ends on its own at its end time.')
  const row = ((closed ?? []) as { id: string; tenant_id: string }[])[0]

  // Never blocks the close: ending a session only reduces access. A failed write is
  // recorded by auditMutation itself (recordAuditFailure). A ticket whose row was already
  // closed (or ended) is recorded too, as closed: false, on the ticket's tenant.
  await auditMutation(
    {
      action: 'support.session.close',
      actor: { userId },
      tenant: { tenantId: row?.tenant_id ?? ticket.tid },
      target: { table: 'support_sessions', id: ticket.sid },
      reason: 'support_session',
      metadata: { mode: ticket.mode, closed: !!row },
    },
    { afterResponse: false },
  )
  return NextResponse.json({ closed: !!row }, { headers: { 'Cache-Control': 'no-store' } })
}
