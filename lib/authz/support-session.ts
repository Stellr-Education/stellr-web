/**
 * lib/authz/support-session.ts — the support-session seam (S6-AW).
 *
 * S6 support mode (docs/PLAN-S6-DRAFT.md) lets a platform admin look into a
 * tenant read-only, and write only through break-glass. S6-SUP builds the
 * session record; until then nothing can open one, so this answers null for
 * every real request.
 *
 * Deliberately pure and cheap: no database read, no Clerk call, nothing
 * awaited. It sits on the hot path of every audited mutation (withAudit,
 * lib/audit/route.ts), and Active CPU is metered. S6-SUP replaces the body
 * with a read of the request's support session, and must keep the normal
 * case (no session) free of extra work.
 */
import type { Principal } from '@/lib/authz/decide'

/** 'read' refuses every admin mutation; 'break_glass' is S6-BG's time-limited write. */
export type SupportSessionMode = 'read' | 'break_glass'

export interface SupportSession {
  mode: SupportSessionMode
}

/**
 * The support session this request runs under, or null. Today: a principal
 * already marked support_read (none is, before S6-SUP) answers 'read'; with no
 * principal, as from withAudit, the answer is null.
 */
export function supportSessionOf(principal?: Pick<Principal, 'mode'> | null): SupportSession | null {
  return principal?.mode === 'support_read' ? { mode: 'read' } : null
}
