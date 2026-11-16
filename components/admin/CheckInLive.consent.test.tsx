import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckInLive from './CheckInLive'

// S5 CONSENT (c), WD-6: the desk list marks a tenant-event participant waiting on
// guardian consent, and its Check in button does nothing; the group row counts
// them and the group sheet marks them. A Stellr event's list has no marker.

vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }))

const REG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const person = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
  id,
  registrationId: REG,
  firstName,
  lastName: 'Example',
  eventRole: 'participant',
  schoolName: null,
  shirtSize: 'M',
  checkedInAt: null,
  checkInMethod: null,
  company: null,
  merch: [],
  merchCollected: false,
  ...extra,
})
const poll = (participants: unknown[]) => ({
  checkInOpen: true,
  checkInToken: 'placeholder-token',
  resourcesUrl: null,
  participants,
  groups: [{ id: REG, label: 'A School', teacher: 'T Example' }],
  crewCheckIns: {},
  bannerTarget: true,
  otherOpen: [],
})

let posts: unknown[]
function stubFetch(state: unknown) {
  posts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (String(url).includes('details=1')) return new Response(JSON.stringify({ flags: {}, contacts: {}, crew: [] }), { status: 200 })
      return new Response(JSON.stringify(state), { status: 200 })
    })
  )
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
  try {
    localStorage.clear()
  } catch {
    /* no storage */
  }
})
afterEach(() => vi.unstubAllGlobals())

const renderDesk = () => render(<CheckInLive eventSlug="tenant-event-2027" eventTitle="Tenant event" siteUrl="https://app.test" isVirtual={false} />)
const row = (name: RegExp) => screen.getByText(name).closest('li') as HTMLElement

describe('the desk list', () => {
  it('marks a participant waiting on consent and will not check them in', async () => {
    stubFetch(poll([person('p-minor', 'Minor', { consentPending: true }), person('p-peer', 'Peer')]))
    const user = userEvent.setup()
    renderDesk()
    await screen.findByText(/Minor Example/)
    const minor = row(/Minor Example/)
    expect(within(minor).getByText('Waiting for guardian consent')).toBeInTheDocument()
    const button = within(minor).getByRole('button', { name: 'Check in' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(posts).toEqual([])
    // The other participant is untouched.
    const peer = row(/Peer Example/)
    expect(within(peer).queryByText('Waiting for guardian consent')).toBeNull()
    expect(within(peer).getByRole('button', { name: 'Check in' })).toBeEnabled()
  })

  it('a Stellr event (nobody marked) shows no marker anywhere', async () => {
    stubFetch(poll([person('p-minor', 'Minor'), person('p-peer', 'Peer')]))
    renderDesk()
    await screen.findByText(/Minor Example/)
    expect(screen.queryByText(/guardian consent/i)).toBeNull()
  })
})

describe('groups', () => {
  it('the group row counts who is waiting on consent, and the sheet marks them', async () => {
    stubFetch(poll([person('p-minor', 'Minor', { consentPending: true }), person('p-peer', 'Peer')]))
    const user = userEvent.setup()
    renderDesk()
    await screen.findByText(/Minor Example/)
    await user.click(screen.getByRole('tab', { name: /^Groups/ }))
    expect(await screen.findByText(/1 waiting for guardian consent/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check in group' }))
    const dialog = await screen.findByRole('dialog')
    const minor = within(dialog).getByText(/Minor Example/).closest('li') as HTMLElement
    expect(within(minor).getByText('Waiting for guardian consent')).toBeInTheDocument()
    expect(within(within(dialog).getByText(/Peer Example/).closest('li') as HTMLElement).queryByText(/guardian consent/)).toBeNull()
  })
})
