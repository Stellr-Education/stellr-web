/**
 * lib/support/break-glass.ts — the S6-BG refusals (docs/S6-DESIGN.md section 3).
 *
 * The rules live in the database (supabase/migrations/20261123144030_support_break_glass.sql):
 * support_consent_decide, support_break_glass_open and support_break_glass_renew each
 * refuse with a code in the error's HINT. This module turns that code into the answer the
 * route gives, so every route words a refusal the same way. The step-up refusal is
 * Clerk's (lib/authz/step-up.ts requireBreakGlassStepUp), and the time limit is also
 * checked on every admin request (lib/authz/writable.ts).
 */

/** Break-glass opens for this long, and a renewal adds as much again, to 60 at most (S6-Q5). */
export const BREAK_GLASS_MINUTES = 30
/** A consent request lapses this long after it is made. The database CHECK allows 24 hours at most. */
export const CONSENT_LAPSE_HOURS = 24
export const REASON_MIN = 20
export const REASON_MAX = 500

export type BreakGlassRefusal =
  | 'break_glass_reason'
  | 'break_glass_no_consent'
  | 'break_glass_ended'
  | 'break_glass_renewed'
  | 'support_session_open'
  | 'consent_not_found'
  | 'consent_not_tenant_admin'
  | 'consent_platform_admin'
  | 'consent_decided'
  | 'consent_lapsed'

const MESSAGES: Record<BreakGlassRefusal, string> = {
  break_glass_reason: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters.`,
  break_glass_no_consent: 'This needs an approved request from one of the tenant’s admins, not yet used or lapsed.',
  break_glass_ended: 'There is no live break-glass session to renew.',
  break_glass_renewed: 'A break-glass session can be renewed once. Ask the tenant again for more time.',
  support_session_open: 'Close your current support session first.',
  consent_not_found: 'Not found',
  consent_not_tenant_admin: 'Only an admin of this organization can answer this request.',
  consent_platform_admin: 'Platform staff cannot answer a request for access on an organization’s behalf.',
  consent_decided: 'This request has already been answered.',
  consent_lapsed: 'This request has lapsed.',
}

/** The refusal code an RPC error carries in its hint, or null for any other failure. */
export function refusalOf(error: unknown): BreakGlassRefusal | null {
  const hint = (error as { hint?: unknown } | null | undefined)?.hint
  return typeof hint === 'string' && hint in MESSAGES ? (hint as BreakGlassRefusal) : null
}

/**
 * The response for a refusal code. The status is each route's to write as a literal:
 * the audit-coverage gate (lib/security/audit-coverage.ts) reads a literal status of 400
 * or more as "the write failed", which is what a refused rpc means.
 */
export function refusalResponse(code: BreakGlassRefusal, status: number): Response {
  return Response.json({ error: MESSAGES[code], code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** A reason trimmed, or null when it is not 20 to 500 characters. */
export function cleanBreakGlassReason(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const reason = value.trim()
  return reason.length >= REASON_MIN && reason.length <= REASON_MAX ? reason : null
}
