/**
 * lib/authz/support-session-server.ts — the full support-session check (S6-SUP).
 *
 * lib/authz/support-session.ts reads the cookie's signature and expiry only, which is
 * enough to refuse a write. Anything that READS under a session (lib/tenancy/support-db.ts,
 * the admin banner) needs this instead:
 *
 *   1. SUPPORT_MODE_ENABLED is exactly 'true' (off: null, with no cookie read);
 *   2. the cookie verifies (signature, shape, not expired);
 *   3. the caller's Clerk user and Clerk session id are the ones the ticket was bound to,
 *      so a copied cookie is nothing in another session, and signing out ends it;
 *   4. the support_sessions row exists, is not closed, has not ended, and names the same
 *      platform admin, tenant and mode. Closing the row ends the session at once, and
 *      removing the platform_admins row deletes it (ON DELETE CASCADE).
 *
 * Any failure, a lookup error included, is no session. The answer is cached per request.
 * Only objects this module built pass isVerifiedSupportSession(), so tenantSupportDb
 * cannot be handed a hand-made session.
 */
import 'server-only'
import { cache } from 'react'
import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { supabaseServer } from '@/lib/supabase'
import {
  decodeSupportTicket,
  SUPPORT_SESSION_COOKIE,
  supportModeEnabled,
  type SupportSessionMode,
} from '@/lib/authz/support-session'

export interface ActiveSupportSession {
  readonly sessionId: string
  readonly tenantId: string
  /** The tenant's display name, for the banner. */
  readonly tenantName: string
  readonly platformAdminUserId: string
  readonly mode: SupportSessionMode
  /** Epoch milliseconds. */
  readonly endsAt: number
}

const VERIFIED = new WeakSet<object>()

/** True only for a session loadSupportSession() verified, and only until it ends. */
export function isVerifiedSupportSession(s: unknown, now: number = Date.now()): s is ActiveSupportSession {
  return !!s && typeof s === 'object' && VERIFIED.has(s) && (s as ActiveSupportSession).endsAt > now
}

interface SessionRow {
  id: string
  tenant_id: string
  platform_admin_user_id: string
  mode: string
  ends_at: string
  closed_at: string | null
  tenants: { display_name: string } | { display_name: string }[] | null
}

/** The row, or null when there is none or the read fails. */
async function readRow(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabaseServer()
    .from('support_sessions')
    .select('id, tenant_id, platform_admin_user_id, mode, ends_at, closed_at, tenants(display_name)')
    .eq('id', sessionId)
    .maybeSingle()
  return error || !data ? null : (data as SessionRow)
}

async function load(): Promise<ActiveSupportSession | null> {
  if (!supportModeEnabled()) return null
  try {
    const ticket = decodeSupportTicket((await cookies()).get(SUPPORT_SESSION_COOKIE)?.value)
    if (!ticket) return null
    const { userId, sessionId } = await auth()
    if (!userId || !sessionId || userId !== ticket.uid || sessionId !== ticket.csid) return null
    const row = await readRow(ticket.sid)
    if (!row || row.closed_at) return null
    const endsAt = Date.parse(row.ends_at)
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) return null
    if (row.platform_admin_user_id !== userId || row.tenant_id !== ticket.tid || row.mode !== ticket.mode) return null
    const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants
    const session: ActiveSupportSession = Object.freeze({
      sessionId: row.id,
      tenantId: row.tenant_id,
      tenantName: tenant?.display_name ?? 'this tenant',
      platformAdminUserId: userId,
      mode: ticket.mode,
      // The earlier of the row's end and the ticket's: neither can extend the other.
      endsAt: Math.min(endsAt, ticket.exp),
    })
    VERIFIED.add(session)
    return session
  } catch {
    return null
  }
}

/** The caller's open, verified support session, or null. Cached per request. */
export const loadSupportSession: () => Promise<ActiveSupportSession | null> = cache(load)
