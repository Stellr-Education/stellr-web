/**
 * lib/authz/writable.ts — assertWritable (S6-AW, docs/PLAN-S6-DRAFT.md).
 *
 * A support-read session (S6 support mode) may not change anything through the
 * admin API. The one enforcement point is withAudit (lib/audit/route.ts), which
 * every mutating admin handler is wrapped in; the few that audit inline call
 * writeRefusal() themselves. test/assert-writable-guard.test.ts fails on any
 * mutating handler under app/api/admin/** that does neither.
 *
 * S6-SUP: with SUPPORT_MODE_ENABLED off (the default everywhere) no support session
 * can exist, so this always passes and costs one null check: supportSessionOf()
 * reads nothing. With it on, a request carrying a validly signed read-mode support
 * cookie is refused (lib/authz/support-session.ts).
 *
 * S6-BG adds two more refusals, both 403 before the handler runs:
 *   - support_session_ended: the cookie is validly signed but past its end time. The
 *     time limit is checked on every admin request, not only when the browser drops
 *     the cookie (docs/S6-DESIGN.md section 3, "Past the time limit").
 *   - break_glass_unsupported: a break-glass session on a route that has not opted in
 *     (withAudit's `breakGlass: true`). A route opts in only once its writes run under
 *     tenantBreakGlassDb (lib/tenancy/support-db.ts), pinned to the session's tenant;
 *     every other route would write with the service role, which break-glass never may.
 *
 * Kept free of 'server-only', Clerk and the database, because lib/audit/route.ts
 * imports it and must stay light (it imports Clerk only on demand).
 */
import type { Principal } from '@/lib/authz/decide'
import { supportSessionOf } from '@/lib/authz/support-session'

export const SUPPORT_READ_ONLY_CODE = 'support_read_only'
export const SUPPORT_SESSION_ENDED_CODE = 'support_session_ended'
export const BREAK_GLASS_UNSUPPORTED_CODE = 'break_glass_unsupported'

export type SupportWriteRefusalCode =
  | typeof SUPPORT_READ_ONLY_CODE
  | typeof SUPPORT_SESSION_ENDED_CODE
  | typeof BREAK_GLASS_UNSUPPORTED_CODE

/** Any refusal assertWritable throws. Answers 403 with its code. */
export class SupportWriteRefusedError extends Error {
  readonly status = 403 as const
  constructor(
    readonly code: SupportWriteRefusalCode,
    message: string,
  ) {
    super(message)
    this.name = 'SupportWriteRefusedError'
  }
}

/** Thrown by assertWritable while a support-read session is active. */
export class ReadOnlySupportSessionError extends SupportWriteRefusedError {
  constructor() {
    super(SUPPORT_READ_ONLY_CODE, 'Support sessions are read-only')
    this.name = 'ReadOnlySupportSessionError'
  }
}

export interface WritableOptions {
  /** The route's writes run under tenantBreakGlassDb, so a break-glass session may use it. */
  breakGlass?: boolean
}

/**
 * Throws a SupportWriteRefusedError when the request's support session may not write here:
 * a read session, a session past its end time, or a break-glass session on a route that
 * has not opted in. Otherwise does nothing. Pass the request where there is one: its
 * support cookie is the session (S6-SUP).
 */
export function assertWritable(principal?: Pick<Principal, 'mode'> | null, req?: unknown, opts: WritableOptions = {}): void {
  const session = supportSessionOf(principal, req)
  if (!session) return
  if (session.ended) throw new SupportWriteRefusedError(SUPPORT_SESSION_ENDED_CODE, 'This support session has ended')
  if (session.mode === 'read') throw new ReadOnlySupportSessionError()
  if (!opts.breakGlass) throw new SupportWriteRefusedError(BREAK_GLASS_UNSUPPORTED_CODE, 'This change is not available in a break-glass session')
}

/** The refusal, shaped like lib/authz's other API refusals ({ error: 'Forbidden' }) plus a code. */
export function supportRefusalResponse(code: SupportWriteRefusalCode): Response {
  return Response.json({ error: 'Forbidden', code }, { status: 403 })
}

/** The read-only refusal. */
export function readOnlyResponse(): Response {
  return supportRefusalResponse(SUPPORT_READ_ONLY_CODE)
}

/**
 * The request is for the admin API. Anything that is not a readable Request counts
 * as admin, so a refusal fails closed. Crons (/api/cron) and provider webhooks
 * (/api/webhooks) are never admin.
 */
export function isAdminApiRequest(req: unknown): boolean {
  const url = (req as { url?: unknown } | null | undefined)?.url
  if (typeof url !== 'string') return true
  try {
    const p = new URL(url, 'http://localhost').pathname
    return p === '/api/admin' || p.startsWith('/api/admin/')
  } catch {
    return true
  }
}

/**
 * The 403 to answer with instead of running an admin mutation, or null to go ahead.
 * The session is checked first, so the normal case never parses the URL.
 */
export function writeRefusal(req: unknown, principal?: Pick<Principal, 'mode'> | null, opts: WritableOptions = {}): Response | null {
  try {
    assertWritable(principal, req, opts)
    return null
  } catch (err) {
    if (err instanceof SupportWriteRefusedError) return isAdminApiRequest(req) ? supportRefusalResponse(err.code) : null
    throw err
  }
}
