import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { RecordLinksProvider } from '@/components/admin/RecordLinks'
import EventRoster from './EventRoster'
import type { RosterOptOut } from '@/lib/roster-optouts'
import type { EventRosterData, RosterGroup, RosterParticipant } from '@/lib/event-admin'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))

// The row actions have their own fetches and dialogs; stand-ins keep this test
// about where they render and how they are sized. Two of them put className on
// a wrapping <span>, as the real components do.
vi.mock('@/components/admin/DeleteEntityButton', () => ({
  DeleteEntityButton: ({ label, className }: { label?: string; className?: string }) => (
    <button type="button" className={className}>{label ?? 'Delete'}</button>
  ),
}))
vi.mock('@/components/admin/CorrectSignerEmailButton', () => ({
  CorrectSignerEmailButton: ({ className }: { className?: string }) => (
    <button type="button" className={`text-xs ${className ?? ''}`}>Correct email</button>
  ),
}))
vi.mock('@/components/admin/SendPayLinkButton', () => ({
  SendPayLinkButton: ({ className }: { className?: string }) => (
    <span className={`inline-flex ${className ?? ''}`}><button type="button">Send pay link</button></span>
  ),
}))
vi.mock('@/components/admin/ReissueDocusignButton', () => ({
  ReissueDocusignButton: ({ className }: { className?: string }) => (
    <span className={`inline-flex ${className ?? ''}`}><button type="button">Reissue DocuSign</button></span>
  ),
}))

const participant: RosterParticipant = {
  id: 'p-1',
  first_name: 'Avery',
  last_name: 'Test',
  email: 'avery@example.com',
  grade: '11',
  gender: null,
  date_of_birth: null,
  t_shirt_size: 'M',
  school_name: 'Example High School',
  event_role: 'participant',
  dietary_requirements: [],
  health_conditions: null,
  company_id: null,
  checked_in_at: null,
  minor: true,
  emergency_contact_name: null,
  emergency_contact_first_name: null,
  emergency_contact_last_name: null,
  emergency_contact_email: null,
  emergency_contact_phone: null,
  emergency_contact_relationship: null,
  paid: false,
  docusign: 'outstanding',
  payment_pill: 'link_unpaid',
  docusign_pill: 'issued',
  docusign_label: 'Issued',
  docusign_detail: 'Awaiting the parent/guardian',
  correctable_agreement_id: 'agr-1',
  compliance_pill: 'not_required',
  refund_detail: null,
  member_id: 'mem-1',
}

const group: RosterGroup = {
  registrationId: 'reg-1',
  type: 'individual',
  status: 'pending',
  groupLabel: null,
  teacherName: null,
  teacherMemberId: null,
  schoolName: null,
  teacherEmail: null,
  teacherFirstName: null,
  invoiceRequested: false,
  invoicePaidAt: null,
  memberPaysIndividually: false,
  payLinkSendable: true,
  scholarship: null,
  participants: [participant],
}

const roster: EventRosterData = {
  groups: [group],
  scholarshipOffers: [],
  summary: {
    totalParticipants: 1,
    groupParticipants: 0,
    individualParticipants: 1,
    groupRegistrations: 0,
    individualRegistrations: 1,
    dietary: [],
    healthIssues: [],
    outstandingPayments: 1,
    outstandingDocusigns: 1,
    checkedIn: 0,
    scholarshipHolders: 0,
  },
}

// esign-native-engine.9 and T-23: the paperwork the roster shows beside the
// DocuSign pill. A pill naming the opt-outs a participant holds (none: no pill),
// and, on another organiser's event, "Waiting for guardian consent" for a
// participant whose guardian has not signed. Stellr's events have no pending
// consent, so their roster reads as before.

function renderRoster({ optOuts, consentPending }: { optOuts?: Record<string, RosterOptOut[]>; consentPending?: string[] } = {}) {
  const result = render(
    <RecordLinksProvider enabled={false}>
      <EventRoster
        roster={roster}
        exportHref="/api/admin/events/demo/export"
        eventSlug="demo"
        companies={[]}
        isAdmin
        optOuts={optOuts}
        consentPending={consentPending}
      />
    </RecordLinksProvider>,
  )
  return result
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /^Individual: Avery Test/ }))
const card = () => screen.getByRole('heading', { name: /^Avery Test/ }).closest('li') as HTMLElement
const row = () => within(screen.getByRole('region', { name: 'Individual registration: Avery Test' })).getByText('Avery Test').closest('tr') as HTMLElement

describe('EventRoster: opt-out pill (esign-native-engine.9)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('names every opt-out held, in the card and the table, with what each box says', () => {
    renderRoster({ optOuts: { 'p-1': ['media', 'quotes', 'digital_comms'] } })
    open()
    for (const scope of [card(), row()]) {
      const pill = within(scope).getByText('Opted out: Media · Quotes · Digital comms')
      // The shared Badge, on V2 tokens.
      expect(pill).toHaveClass('rounded-pill', 'bg-surface', 'text-ink')
      expect(pill.parentElement).toHaveAttribute(
        'title',
        'Ticked on the signed agreement: no photo or media use; no quoting their survey responses; no direct digital communications',
      )
    }
  })

  it('shows only what is held', () => {
    renderRoster({ optOuts: { 'p-1': ['quotes'] } })
    open()
    expect(within(card()).getByText('Opted out: Quotes')).toBeInTheDocument()
  })

  it('no pill when none are held, or nothing was read', () => {
    renderRoster({ optOuts: { 'p-1': [] } })
    open()
    expect(screen.queryByText(/Opted out/)).not.toBeInTheDocument()
  })

  it('no pill when the page passes nothing', () => {
    renderRoster()
    open()
    expect(screen.queryByText(/Opted out/)).not.toBeInTheDocument()
  })
})

describe('EventRoster: pending guardian consent marker (T-23)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it("another organiser's event: a participant whose guardian has not signed is marked, not shown as registered", () => {
    renderRoster({ consentPending: ['p-1'] })
    // The folded summary counts them, so staff see it without opening the registration.
    expect(screen.getByRole('button', { name: /^Individual: Avery Test/ })).toHaveTextContent('1 waiting for guardian consent')
    open()
    for (const scope of [card(), row()]) {
      const marker = within(scope).getByText('Waiting for guardian consent')
      expect(marker).toHaveClass('rounded-pill', 'bg-pathway-amber-bg', 'text-gold-ink')
      expect(within(scope).queryByText('Registered')).not.toBeInTheDocument()
    }
    // Wave 8 CONSENT (c): staff can resend the guardian's form, in the card and the table.
    for (const scope of [card(), row()]) {
      expect(within(scope).getByRole('button', { name: 'Resend consent form' })).toBeInTheDocument()
    }
  })

  it('the resend posts for that participant, with no body, and says what happened', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ ok: true, outcome: 'reminded' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderRoster({ consentPending: ['p-1'] })
    open()
    fireEvent.click(within(card()).getByRole('button', { name: 'Resend consent form' }))
    await waitFor(() => expect(within(card()).getByRole('status')).toHaveTextContent('Reminder sent to the guardian.'))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/participants\/p-1\/guardian-consent\/resend$/)
    expect(init).toEqual({ method: 'POST' })
    vi.unstubAllGlobals()
  })

  it("a refused resend shows the server's reason", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The consent form was sent recently. Try again later.' }), { status: 429 })))
    renderRoster({ consentPending: ['p-1'] })
    open()
    fireEvent.click(within(row()).getByRole('button', { name: 'Resend consent form' }))
    await waitFor(() => expect(within(row()).getByRole('status')).toHaveTextContent('The consent form was sent recently. Try again later.'))
    vi.unstubAllGlobals()
  })

  it("a Stellr event: no pending consent exists, so the roster is unchanged", () => {
    renderRoster({ consentPending: [] })
    expect(screen.getByRole('button', { name: /^Individual: Avery Test/ })).not.toHaveTextContent('guardian consent')
    open()
    expect(screen.queryByText('Waiting for guardian consent')).not.toBeInTheDocument()
    expect(within(card()).getByText('Registered')).toBeInTheDocument()
    expect(within(row()).getByText('Registered')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend consent form' })).not.toBeInTheDocument()
  })

  it('another participant pending does not mark this one', () => {
    renderRoster({ consentPending: ['p-other'] })
    open()
    expect(screen.queryByText('Waiting for guardian consent')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend consent form' })).not.toBeInTheDocument()
  })
})
