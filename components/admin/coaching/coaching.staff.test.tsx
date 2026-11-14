import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import type { CoachingRequest } from '@/lib/coaching-requests'
import { CoachingRequestQueue } from './CoachingRequestQueue'
import { CoachingMembershipAccess } from './CoachingMembershipAccess'
import { AdminManageWorkshop } from './AdminManageWorkshop'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// Coaching is academy:manage, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const request: CoachingRequest = {
  id: 'r-1', memberId: 'm-1', memberName: 'Member One', memberEmail: null, topic: 'Pitching our design', stage: null, focusArea: null,
  availability: [], note: null, status: 'pending', coachId: null, coachName: null, eligibility: null, workshopId: null, sessionId: null,
  declineReason: null, createdAt: '2026-11-01T00:00:00Z', matchedAt: null, scheduledAt: null, session: null,
}
const queue = <CoachingRequestQueue requests={[request]} coaches={[{ id: 'c-1', name: 'Coach One' }]} />
const access = (
  <CoachingMembershipAccess
    tiers={[{ id: 't-1', name: 'Explorer', monthlyPriceCents: 1000, freeSessions: 6 }]}
    workshops={[{ id: 'w-1', name: 'Workshop One', freeForTierIds: [], oneOffPriceCents: null }]}
  />
)
const workshop = (
  <AdminManageWorkshop
    workshop={{
      id: 'w-1', name: 'Workshop One', timezone: 'America/Denver', plannedSessions: 1, coachMemberId: null, coachName: null,
      memberId: 'm-1', memberName: 'Member One', memberEmail: null, memberStatus: 'active', freeForTierIds: [], oneOffPriceCents: null,
    }}
    sessions={[]}
    resources={[]}
    fileResources={[]}
    recordings={[]}
    modules={[]}
    tiers={[]}
    channelId="ch-1"
    selfMemberId="m-0"
    flaggedCount={0}
  />
)

describe('Coaching — admin', () => {
  it('matches or declines a request', () => {
    asAdmin(queue)
    expect(screen.getByRole('button', { name: 'Confirm match' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })
  it('sets access and prices', () => {
    asAdmin(access)
    expect(screen.getByRole('spinbutton', { name: 'Free sessions per year, Explorer' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
  it('manages a workshop', () => {
    asAdmin(workshop)
    expect(screen.getByRole('button', { name: 'Reassign coach' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Replace member/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })
})

describe('Coaching — Staff', () => {
  it('sees the request without match or decline, and is told an admin does it', () => {
    asStaff(queue)
    expect(screen.getByText('Pitching our design')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('An admin matches the request with a coach or declines it.')).toBeInTheDocument()
  })
  it('sees access and prices read-only', () => {
    asStaff(access)
    expect(screen.getByText('An admin sets coaching access and prices. You can see them here.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Free sessions per year, Explorer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Free coaching' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
  it('sees a workshop without the controls', () => {
    asStaff(workshop)
    expect(screen.getByText('An admin manages this workshop: its member, schedule, resources and settings. You can see them here.')).toBeInTheDocument()
    expect(screen.getAllByText('Member One').length).toBeGreaterThan(0)
    for (const name of ['Reassign coach', /Replace member/, 'Remove']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})
