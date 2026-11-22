/**
 * F4 step-up, browser side: a reverification error opens Clerk's dialog (here a
 * stand-in for useReverification that completes or cancels) and the request is
 * retried; anything else is the plain response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.unmock('@/components/admin/use-step-up-fetch')

const dialog = { outcome: 'complete' as 'complete' | 'cancel', opened: 0 }

vi.mock('@clerk/nextjs', async () => {
  const { isReverificationHint } = await import('@/lib/step-up-download')
  return {
    // The shape of Clerk's useReverification: run the fetcher; on a hint, "open
    // the dialog", then retry once or reject as cancelled.
    useReverification:
      (fetcher: (...a: unknown[]) => Promise<unknown>) =>
      async (...args: unknown[]) => {
        const first = await fetcher(...args)
        if (!isReverificationHint(first)) return first
        dialog.opened++
        if (dialog.outcome === 'cancel') throw Object.assign(new Error('cancelled'), { code: 'reverification_cancelled' })
        return fetcher(...args)
      },
  }
})
vi.mock('@clerk/nextjs/errors', () => ({
  isReverificationCancelledError: (e: unknown) => (e as { code?: string })?.code === 'reverification_cancelled',
}))

import { STEP_UP_REFUSED, useStepUpFetch } from './use-step-up-fetch'

const HINT = { clerk_error: { type: 'forbidden', reason: 'reverification-error', metadata: { reverification: { level: 'first_factor', afterMinutes: 10 } } } }
const hintResponse = () => new Response(JSON.stringify(HINT), { status: 403, headers: { 'Content-Type': 'application/json' } })

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  dialog.outcome = 'complete'
  dialog.opened = 0
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function hook() {
  return renderHook(() => useStepUpFetch()).result.current
}

describe('useStepUpFetch', () => {
  it('passes an ordinary response straight through (the flag-off path)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('a,b\n1,2', { status: 200 }))
    const res = await hook()('/api/admin/members/export')
    expect(await res.text()).toBe('a,b\n1,2')
    expect(dialog.opened).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a plain 403 is not a re-verification: returned as is', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    const res = await hook()('/api/admin/members/export')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(dialog.opened).toBe(0)
  })

  it('a reverification error opens the dialog and retries the same request', async () => {
    fetchMock.mockResolvedValueOnce(hintResponse()).mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const init = { method: 'POST', body: '{"memberId":"x"}' }
    const res = await hook()('/api/admin/impersonation', init)
    expect(await res.text()).toBe('ok')
    expect(dialog.opened).toBe(1)
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/impersonation', init)
  })

  it('cancelled: a 403 with a plain error, nothing thrown', async () => {
    dialog.outcome = 'cancel'
    fetchMock.mockResolvedValueOnce(hintResponse())
    const res = await hook()('/api/admin/members/export')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: STEP_UP_REFUSED })
  })

  it('still refused after re-verifying: a 403 with a plain error', async () => {
    fetchMock.mockResolvedValueOnce(hintResponse()).mockResolvedValueOnce(hintResponse())
    const res = await hook()('/api/admin/members/export')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: STEP_UP_REFUSED })
  })
})
