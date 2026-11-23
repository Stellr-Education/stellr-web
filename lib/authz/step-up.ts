/**
 * Step-up re-verification before view-as and bulk personal-data exports (F4, 21 Nov 2026).
 *
 * With ADMIN_STEP_UP_ENFORCE exactly 'true', starting a view-as session and the
 * listed exports need a sign-in factor confirmed in the last STEP_UP_MINUTES.
 * Otherwise Clerk's reverification error comes back (a 403 whose body
 * useReverification recognises), the browser opens Clerk's "confirm it's you"
 * dialog, and the request is retried. Any other value, or none, is a no-op: no
 * extra Clerk call, nothing changes for anyone.
 *
 * First factor only. Production Clerk is on the Free plan, where MFA cannot be
 * enabled, so a password or an email code is what an admin can re-enter. When
 * MFA arrives (Clerk Pro), raise STEP_UP_REVERIFICATION to 'strict'; Clerk
 * downgrades to first factor for anyone without a second factor.
 *
 * The check runs AFTER each route's own authorisation check, never instead of
 * it: an unauthorised caller still gets that route's 401/403, and is never
 * offered a re-verification. test/step-up-routes.test.ts fails when a listed
 * route stops calling requireStepUp.
 */
import { auth, reverificationErrorResponse } from '@clerk/nextjs/server'

export const ADMIN_STEP_UP_ENV = 'ADMIN_STEP_UP_ENFORCE'

/** How recently the factor must have been confirmed. Clerk's 'strict' window. */
export const STEP_UP_MINUTES = 10

/** Clerk's ReverificationConfig for the step-up: a first factor in the last STEP_UP_MINUTES. */
export const STEP_UP_REVERIFICATION = { level: 'first_factor', afterMinutes: STEP_UP_MINUTES } as const

/** Read per request, like the other *_ENFORCE flags, so a redeploy is not needed to read a change. */
export function stepUpEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env[ADMIN_STEP_UP_ENV] === 'true'
}

export type StepUpDecision = 'skip' | 'pass' | 'reverify'

/**
 * Pure: off is 'skip' (and `isFresh` is never called); on, a fresh factor is
 * 'pass' and anything else 'reverify'.
 */
export async function decideStepUp(enforced: boolean, isFresh: () => boolean | Promise<boolean>): Promise<StepUpDecision> {
  if (!enforced) return 'skip'
  return (await isFresh()) ? 'pass' : 'reverify'
}

/**
 * The route wrapper: null to carry on, or the Response to return. Call it after
 * the route's own authorisation check.
 */
export async function requireStepUp(): Promise<Response | null> {
  const decision = await decideStepUp(stepUpEnforced(), async () => {
    const { has } = await auth()
    return has({ reverification: STEP_UP_REVERIFICATION })
  })
  if (decision !== 'reverify') return null
  const res = reverificationErrorResponse(STEP_UP_REVERIFICATION)
  res.headers.set('Content-Type', 'application/json')
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** S6-BG: break-glass needs a factor confirmed this recently (docs/S6-DESIGN.md section 3). */
export const BREAK_GLASS_STEP_UP_MINUTES = 5

/** Clerk's ReverificationConfig for break-glass: a first factor in the last 5 minutes. */
export const BREAK_GLASS_REVERIFICATION = { level: 'first_factor', afterMinutes: BREAK_GLASS_STEP_UP_MINUTES } as const

/**
 * The strict step-up: a factor in the last 5 minutes, required whatever
 * ADMIN_STEP_UP_ENFORCE says. For the platform's most consequential actions: opening
 * and renewing break-glass (S6-BG) and suspending or resuming a tenant (S6-CON). Null to
 * carry on, or Clerk's reverification response. Call it after the route's own
 * authorisation.
 */
export async function requireStrictStepUp(): Promise<Response | null> {
  const decision = await decideStepUp(true, async () => {
    const { has } = await auth()
    return has({ reverification: BREAK_GLASS_REVERIFICATION })
  })
  if (decision !== 'reverify') return null
  const res = reverificationErrorResponse(BREAK_GLASS_REVERIFICATION)
  res.headers.set('Content-Type', 'application/json')
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/** S6-BG's name for the strict step-up. */
export const requireBreakGlassStepUp = requireStrictStepUp
