import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// S6-SUP-UI: the support panel's buttons call the support routes with the right bodies.
// vitest.setup.ts swaps useStepUpFetch for plain fetch.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const { TenantSupportActions } = await import('./TenantSupportActions')

const TENANT = '5e550000-0000-4000-8000-0000000000b2'
const REASON = 'Ticket 4521: registrations missing'
const fetchMock = vi.fn(async (..._a: unknown[]) => new Response('{}', { status: 200 }))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  refresh.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

const typeReason = () => fireEvent.change(screen.getByRole('textbox'), { target: { value: REASON } })
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit]
  return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined }
}

describe('TenantSupportActions', () => {
  it('needs a reason of 20 characters before anything is enabled', () => {
    render(<TenantSupportActions tenantId={TENANT} session={null} consents={[]} />)
    expect(screen.getByRole('button', { name: 'Open read-only session' })).toBeDisabled()
    typeReason()
    expect(screen.getByRole('button', { name: 'Open read-only session' })).toBeEnabled()
  })

  it('opens a read session', async () => {
    render(<TenantSupportActions tenantId={TENANT} session={null} consents={[]} />)
    typeReason()
    fireEvent.click(screen.getByRole('button', { name: 'Open read-only session' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(call()).toEqual({ url: '/api/admin/support/session', method: 'POST', body: { tenantId: TENANT, reason: REASON, minutes: 30 } })
  })

  it('asks the organization for break-glass', async () => {
    render(<TenantSupportActions tenantId={TENANT} session={null} consents={[]} />)
    typeReason()
    fireEvent.click(screen.getByRole('button', { name: 'Ask to make changes' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Request sent/))
    expect(call()).toEqual({ url: '/api/admin/support/consent', method: 'POST', body: { tenantId: TENANT, reason: REASON } })
  })

  it('opens break-glass from an approved request, and shows each request without a reason', async () => {
    render(
      <TenantSupportActions
        tenantId={TENANT}
        session={null}
        consents={[
          { id: 'c-ok', requestedAt: '2026-11-23T10:00:00Z', expiresAt: '2026-11-24T10:00:00Z', status: 'approved' },
          { id: 'c-old', requestedAt: '2026-11-20T10:00:00Z', expiresAt: '2026-11-21T10:00:00Z', status: 'lapsed' },
        ]}
      />,
    )
    expect(screen.getByText('Approved, ready to use')).toBeInTheDocument()
    expect(screen.getByText('Lapsed')).toBeInTheDocument()
    typeReason()
    fireEvent.click(screen.getByRole('button', { name: 'Open break-glass (30 minutes)' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(call()).toEqual({ url: '/api/admin/support/break-glass', method: 'POST', body: { consentId: 'c-ok', reason: REASON } })
  })

  it('in break-glass here: renews and ends', async () => {
    render(<TenantSupportActions tenantId={TENANT} session={{ mode: 'break_glass', endsAt: Date.now() + 600_000, here: true, tenantName: 'B' }} consents={[]} />)
    expect(screen.getByRole('link', { name: 'Open the support view' })).toHaveAttribute('href', '/admin/platform/support')
    typeReason()
    fireEvent.click(screen.getByRole('button', { name: 'Renew for 30 minutes' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(call()).toEqual({ url: '/api/admin/support/break-glass', method: 'PATCH', body: { reason: REASON } })
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(call(1)).toEqual({ url: '/api/admin/support/session', method: 'DELETE', body: undefined })
  })

  it('a session open elsewhere: says so and offers nothing here', () => {
    render(<TenantSupportActions tenantId={TENANT} session={{ mode: 'read', endsAt: Date.now() + 600_000, here: false, tenantName: 'Other Org' }} consents={[]} />)
    expect(screen.getByText(/open on Other Org/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open read-only session' })).toBeNull()
  })

  it('shows the route’s refusal', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Close your current support session first.' }), { status: 409 }))
    render(<TenantSupportActions tenantId={TENANT} session={null} consents={[]} />)
    typeReason()
    fireEvent.click(screen.getByRole('button', { name: 'Open read-only session' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Close your current support session first.'))
  })
})
