'use client'

import { useId } from 'react'
import type { SpamGuardFieldProps } from '@/components/forms/useSpamGuard'

/**
 * The honeypot input for useSpamGuard(). No person sees it, tabs into it, has
 * it autofilled or hears it read out; a form-filling bot fills it.
 *
 * Off-screen, never display:none or `hidden`: better-written bots skip those
 * precisely because they read as traps. `tabIndex={-1}` keeps keyboard users
 * out, `autoComplete="off"` keeps password managers out (a real person's
 * autofill would look exactly like a bot), and `aria-hidden` keeps screen
 * readers quiet.
 */
export function SpamGuardFields({ inputRef }: SpamGuardFieldProps) {
  const id = useId()
  return (
    <div aria-hidden="true" className="absolute left-[-9999px] w-px h-px overflow-hidden">
      <label htmlFor={id}>Website</label>
      <input
        ref={inputRef}
        id={id}
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        defaultValue=""
      />
    </div>
  )
}
