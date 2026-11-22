import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { setShadowRandom } from '@/lib/authz/shadow-sample'

// F4 step-up: useStepUpFetch wraps Clerk's useReverification, which needs a ClerkProvider.
// Component tests render without one, so it is plain fetch here (what it is with
// ADMIN_STEP_UP_ENFORCE off). components/admin/use-step-up-fetch.test.tsx unmocks it.
vi.mock('@/components/admin/use-step-up-fetch', () => {
  // One function, like the real hook's useCallback, so effects depending on it do not loop.
  const plainFetch = (input: string, init?: RequestInit) => fetch(input, init)
  return {
    STEP_UP_REFUSED: 'Confirm it’s you to continue: re-enter your password or email code when asked.',
    useStepUpFetch: () => plainFetch,
  }
})

// AUTHZ_SOURCE=shadow compares a Clerk denial for a sampled share only (lib/authz/shadow-sample.ts).
// A draw of 0 falls under any share above 0, so every test sees each denial compared, as the
// shadow tests were written for, and none flakes on a random draw. lib/authz/authz.test.ts
// injects its own draws to test the sampling itself.
beforeEach(() => {
  setShadowRandom(() => 0)
})

afterEach(() => {
  cleanup()
})
