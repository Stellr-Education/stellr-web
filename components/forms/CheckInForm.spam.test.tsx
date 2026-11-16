import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckInForm from './CheckInForm'

// spam.L1b at the door: the check-in form carries the honeypot and sends it, and
// sends no timing (the route runs no timing trap at check-in).

afterEach(() => vi.unstubAllGlobals())

function stubFetch() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ error: 'x' }), { status: 404 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function submitByEmail() {
  const user = userEvent.setup()
  const { container } = render(<CheckInForm slug="tenant-event" token="placeholder-token" isVirtual={false} initialView={null} />)
  await user.click(screen.getByRole('button', { name: /use my email instead/i }))
  await user.type(screen.getByRole('textbox'), 'family@example.test')
  return { user, container }
}

describe('CheckInForm honeypot', () => {
  it('renders the hidden honeypot, out of the accessibility tree', async () => {
    stubFetch()
    const { container } = await submitByEmail()
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')
    expect(trap).not.toBeNull()
    expect(trap).toHaveAttribute('tabindex', '-1')
    // The only textbox a person can reach is the email field.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('sends an empty honeypot and no timing on a normal submission', async () => {
    const fetchMock = stubFetch()
    const { user } = await submitByEmail()
    await user.click(screen.getByRole('button', { name: 'Check in' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toEqual({ slug: 'tenant-event', token: 'placeholder-token', email: 'family@example.test', website: '' })
  })

  it('sends what a bot typed into the honeypot', async () => {
    const fetchMock = stubFetch()
    const { user, container } = await submitByEmail()
    container.querySelector<HTMLInputElement>('input[name="website"]')!.value = 'https://spam.example'
    await user.click(screen.getByRole('button', { name: 'Check in' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).website).toBe('https://spam.example')
  })
})
