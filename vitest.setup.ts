import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setShadowRandom } from '@/lib/authz/shadow-sample'

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
