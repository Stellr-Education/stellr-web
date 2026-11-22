'use client'

/**
 * F4 step-up, browser side (lib/authz/step-up.ts is the server side).
 *
 * useStepUpFetch is fetch, except that a reverification error from the server
 * opens Clerk's "confirm it's you" dialog and retries the request once the
 * admin has re-entered a sign-in factor. With ADMIN_STEP_UP_ENFORCE off the
 * server never sends that error, so it behaves as plain fetch.
 *
 * vitest.setup.ts swaps this module for plain fetch, so component tests need no
 * ClerkProvider; components/admin/use-step-up-fetch.test.tsx tests the real one.
 */
import { useCallback } from 'react'
import { useReverification } from '@clerk/nextjs'
import { isReverificationCancelledError } from '@clerk/nextjs/errors'
import { isReverificationHint } from '@/lib/step-up-download'

export const STEP_UP_REFUSED = 'Confirm it’s you to continue: re-enter your password or email code when asked.'

type Wrapped = { res: Response } | { clerk_error: unknown }

function refused(): Response {
  return new Response(JSON.stringify({ error: STEP_UP_REFUSED }), { status: 403, headers: { 'Content-Type': 'application/json' } })
}

/** fetch, with Clerk's re-verification dialog and a retry on a reverification error. */
export function useStepUpFetch(): (input: string, init?: RequestInit) => Promise<Response> {
  const run = useReverification(async (input: string, init?: RequestInit): Promise<Wrapped> => {
    const res = await fetch(input, init)
    if (res.status === 403) {
      const body: unknown = await res
        .clone()
        .json()
        .catch(() => null)
      // The hint itself goes back to useReverification, which opens the dialog.
      if (isReverificationHint(body)) return body as { clerk_error: unknown }
    }
    // Wrapped, so useReverification does not read the body as JSON.
    return { res }
  })
  return useCallback(
    async (input: string, init?: RequestInit) => {
      try {
        const out = await run(input, init)
        return out && typeof out === 'object' && 'res' in out && out.res instanceof Response ? out.res : refused()
      } catch (e) {
        if (isReverificationCancelledError(e)) return refused()
        throw e
      }
    },
    [run],
  )
}
