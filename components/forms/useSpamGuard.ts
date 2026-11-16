'use client'

import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { MAX_DWELL_MS } from '@/lib/spam-guard'

/**
 * The client half of the public forms' honeypot and timing trap
 * (docs/REC-form-spam-hardening.md §3). The server half, and what each field
 * means, is lib/spam-guard.ts.
 *
 *   const spam = useSpamGuard()
 *   …
 *   <SpamGuardFields {...spam.fields} />
 *   …
 *   body: JSON.stringify({ ...data, ...(await spam.values()) })
 *
 * A hook rather than react-hook-form fields because half the forms build their
 * body by hand. It works the same under either.
 */

export interface SpamGuardValues {
  website: string
  renderedAt?: number
  submittedAt?: number
}

export interface SpamGuardFieldProps {
  inputRef: RefObject<HTMLInputElement | null>
}

export function useSpamGuard(): {
  fields: SpamGuardFieldProps
  values: () => Promise<SpamGuardValues>
} {
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Epoch time for the server, and the monotonic clock for the dwell, so a
  // clock change mid-visit cannot skew it.
  const mounted = useRef<{ epoch: number; perf: number } | null>(null)

  useEffect(() => {
    mounted.current = { epoch: Date.now(), perf: performance.now() }
  }, [])

  // Async so a later layer (a Turnstile token, L2) can join without every
  // caller changing.
  const values = useCallback(async (): Promise<SpamGuardValues> => {
    // Read the DOM, not React state: a bot that sets input.value directly
    // fires no change event.
    const website = inputRef.current?.value ?? ''
    const start = mounted.current
    // Submitted before the effect ran: no timing to send, and the server
    // accepts a body without it.
    if (!start) return { website }

    const dwell = performance.now() - start.perf
    // A submission faster than the server's floor is sent as it is: that is
    // the trap. A tab left open past the ceiling is a person coming back to
    // it, not a replay: send no timing, so the server accepts it with a
    // warning instead of dropping it.
    if (dwell > MAX_DWELL_MS) return { website }

    return { website, renderedAt: start.epoch, submittedAt: Math.round(start.epoch + dwell) }
  }, [])

  return { fields: { inputRef }, values }
}
