import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { MembershipAccess } from './MembershipAccess'
import { AdminManageCohort } from './AdminManageCohort'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// Mentoring is academy:manage, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const access = (
  <MembershipAccess
    tiers={[{ id: 't-1', name: 'Explorer', monthlyPriceCents: 1000, includesFreeMentoring: true, creditsGrant: 1, workshopCreditsGrant: 0 }]}
    cohorts={[{ id: 'co-1', name: 'Cohort One', freeForTierIds: [], oneOffPriceCents: null, creditCost: 1 }]}
  />
)

const cohort = (
  <AdminManageCohort
    cohort={{ id: 'co-1', name: 'Cohort One', theme: 'space' as never, timezone: 'America/Denver', plannedSessions: 2, mentorMemberId: null, mentorName: null, freeForTierIds: [], oneOffPriceCents: null }}
    roster={[{ memberId: 'm-1', name: 'Member One', email: null, status: 'active', actionsDone: 0, actionsTotal: 0 }]}
    sessions={[]}
    resources={[]}
    modules={[]}
    tiers={[]}
    channelId="ch-1"
    selfMemberId="m-0"
    flaggedCount={0}
  />
)

describe('Mentoring — admin', () => {
  it('sets access and credits', () => {
    asAdmin(access)
    expect(screen.getByRole('spinbutton', { name: 'Cohort credits per year, Explorer' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
  it('manages a cohort’s members and schedule', async () => {
    const user = userEvent.setup()
    asAdmin(cohort)
    expect(screen.getByRole('button', { name: /Invite member/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make mentor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(screen.getByRole('button', { name: 'Schedule all sessions' })).toBeInTheDocument()
  })
})

describe('Mentoring — Staff', () => {
  it('sees access and credits read-only', () => {
    asStaff(access)
    expect(screen.getByText('An admin sets mentoring access, credits and prices. You can see them here.')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Cohort credits per year, Explorer' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
  it('sees a cohort’s members and schedule without the controls', async () => {
    const user = userEvent.setup()
    asStaff(cohort)
    expect(screen.getByText('An admin manages this cohort: its members, schedule, resources and settings. You can see them here.')).toBeInTheDocument()
    expect(screen.getByText('Member One')).toBeInTheDocument()
    for (const name of [/Invite member/, 'Make mentor', 'Remove', 'Resend invite']) expect(screen.queryByRole('button', { name })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(screen.queryByRole('button', { name: 'Schedule all sessions' })).toBeNull()
    expect(screen.getByText('Session 1')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Schedule' })).toHaveLength(1) // the tab, not a slot's button
  })
  it('sees a cohort’s settings with every control disabled', async () => {
    const user = userEvent.setup()
    asStaff(cohort)
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    for (const b of screen.getAllByRole('button', { name: /Save|Archive|Delete/ })) expect(b).toBeDisabled()
  })
})
