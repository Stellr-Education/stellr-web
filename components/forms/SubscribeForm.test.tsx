import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubscribeForm } from './SubscribeForm'
import { __resetMemberPrefillCache } from './useMemberPrefill'

// deep review PUB-10: the site-wide footer subscribe field was placeholder-only,
// so it had no programmatic label for assistive tech (WCAG 1.3.1 / 4.1.2 / 3.3.2).
afterEach(() => {
  __resetMemberPrefillCache()
  vi.unstubAllGlobals()
})

describe('SubscribeForm', () => {
  it('gives the email field an accessible name', () => {
    render(<SubscribeForm />)
    expect(screen.getByRole('textbox', { name: /email address/i })).toBeInTheDocument()
  })

  // spam.L1b: the honeypot adds no textbox anyone can reach, and the body
  // carries the honeypot and timing fields for /api/subscribe to check.
  it('adds no reachable field and sends the spam-guard values', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<SubscribeForm />)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)

    await user.type(screen.getByRole('textbox', { name: /email address/i }), 'reader@example.test')
    await user.click(screen.getByRole('button', { name: 'Subscribe' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/subscribe')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/subscribe')!
    const body = JSON.parse(String(init!.body))
    expect(body).toMatchObject({ email: 'reader@example.test', website: '' })
    expect(body.renderedAt).toEqual(expect.any(Number))
    expect(body.submittedAt).toBeGreaterThanOrEqual(body.renderedAt)
  })
})
