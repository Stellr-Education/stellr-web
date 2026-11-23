/**
 * lib/authz/writable.ts — assertWritable (S6-AW, docs/PLAN-S6-DRAFT.md).
 *
 * A support-read session (S6 support mode) may not change anything through the
 * admin API. The one enforcement point is withAudit (lib/audit/route.ts), which
 * every mutating admin handler is wrapped in; the few that audit inline call
 * writeRefusal() themselves. test/assert-writable-guard.test.ts fails on any
 * mutating handler under app/api/admin/** that does neither.
 *
 * No support session can exist until S6-SUP, so today this always passes, and
 * costs one null check: supportSessionOf() reads nothing.
 *
 * Kept free of 'server-only', Clerk and the database, because lib/audit/route.ts
 * imports it and must stay light (it imports Clerk only on demand).
 */
import type { Principal } from '@/lib/authz/decide'
import { supportSessionOf } from '@/lib/authz/support-session'

export const SUPPORT_READ_ONLY_CODE = 'support_read_only'

/** Thrown by assertWritable while a support-read session is active. Answers 403. */
export class ReadOnlySupportSessionError extends Error {
  readonly status = 403 as const
  readonly code = SUPPORT_READ_ONLY_CODE
  constructor() {
    super('Support sessions are read-only')
    this.name = 'ReadOnlySupportSessionError'
  }
}

/** Throws ReadOnlySupportSessionError while a support-read session is active; otherwise does nothing. */
export function assertWritable(principal?: Pick<Principal, 'mode'> | null): void {
  if (supportSessionOf(principal)?.mode === 'read') throw new ReadOnlySupportSessionError()
}

/** The refusal, shaped like lib/authz's other API refusals ({ error: 'Forbidden' }) plus a code. */
export function readOnlyResponse(): Response {
  return Response.json({ error: 'Forbidden', code: SUPPORT_READ_ONLY_CODE }, { status: 403 })
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
export function writeRefusal(req: unknown, principal?: Pick<Principal, 'mode'> | null): Response | null {
  try {
    assertWritable(principal)
    return null
  } catch (err) {
    if (err instanceof ReadOnlySupportSessionError) return isAdminApiRequest(req) ? readOnlyResponse() : null
    throw err
  }
}
