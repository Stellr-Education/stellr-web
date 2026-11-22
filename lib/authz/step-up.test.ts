/**
 * F4 step-up helper: off is a no-op with no Clerk call; on, a fresh first factor
 * passes and a stale one gets Clerk's reverification error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const has = vi.fn((_p: unknown) => true)
vi.mock('@clerk/nextjs/server', async () => {
  const { reverificationErrorResponse } = await vi.importActual<typeof import('@clerk/nextjs/server')>('@clerk/nextjs/server')
  return { auth: vi.fn(async () => ({ userId: 'user_x', has })), reverificationErrorResponse }
})

import { auth } from '@clerk/nextjs/server'
import { isReverificationHint } from '@/lib/step-up-download'
import { decideStepUp, requireStepUp, STEP_UP_REVERIFICATION, stepUpEnforced } from './step-up'

beforeEach(() => {
  has.mockClear()
  vi.mocked(auth).mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('stepUpEnforced', () => {
  it('is on only for exactly "true"', () => {
    expect(stepUpEnforced({})).toBe(false)
    expect(stepUpEnforced({ ADMIN_STEP_UP_ENFORCE: 'True' })).toBe(false)
    expect(stepUpEnforced({ ADMIN_STEP_UP_ENFORCE: '1' })).toBe(false)
    expect(stepUpEnforced({ ADMIN_STEP_UP_ENFORCE: 'true' })).toBe(true)
  })
})

describe('decideStepUp', () => {
  it('off: skip, without asking', async () => {
    const fresh = vi.fn(() => false)
    expect(await decideStepUp(false, fresh)).toBe('skip')
    expect(fresh).not.toHaveBeenCalled()
  })
  it('on: pass when fresh, reverify when not', async () => {
    expect(await decideStepUp(true, () => true)).toBe('pass')
    expect(await decideStepUp(true, async () => false)).toBe('reverify')
  })
})

describe('requireStepUp', () => {
  it('flag off: null, and no Clerk call at all', async () => {
    has.mockReturnValue(false)
    expect(await requireStepUp()).toBeNull()
    expect(auth).not.toHaveBeenCalled()
    expect(has).not.toHaveBeenCalled()
  })

  it('flag set to anything but "true": still off', async () => {
    vi.stubEnv('ADMIN_STEP_UP_ENFORCE', 'yes')
    has.mockReturnValue(false)
    expect(await requireStepUp()).toBeNull()
    expect(auth).not.toHaveBeenCalled()
  })

  it('flag on and a fresh first factor: null', async () => {
    vi.stubEnv('ADMIN_STEP_UP_ENFORCE', 'true')
    has.mockReturnValue(true)
    expect(await requireStepUp()).toBeNull()
    expect(has).toHaveBeenCalledWith({ reverification: STEP_UP_REVERIFICATION })
  })

  it('flag on and a stale factor: Clerk’s reverification error, uncached', async () => {
    vi.stubEnv('ADMIN_STEP_UP_ENFORCE', 'true')
    has.mockReturnValue(false)
    const res = await requireStepUp()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(res!.headers.get('Cache-Control')).toBe('no-store')
    const body = await res!.json()
    expect(isReverificationHint(body)).toBe(true)
    expect(body.clerk_error.metadata.reverification).toEqual({ level: 'first_factor', afterMinutes: 10 })
  })

  it('asks for a first factor only: Clerk Free has no second factor to ask for', () => {
    expect(STEP_UP_REVERIFICATION.level).toBe('first_factor')
  })
})
