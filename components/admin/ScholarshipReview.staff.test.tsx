import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { ScholarshipCancelButton, ScholarshipResendButton, ScholarshipRetryRefundButton, ScholarshipReview } from './ScholarshipReview'
import { ScholarshipNotes } from './ScholarshipNotes'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// Scholarship decisions are scholarships:write, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const review = (
  <ScholarshipReview
    id="app-1"
    applicantEmail="applicant@example.test"
    initialEventSlug="ev-1"
    events={[{ slug: 'ev-1', title: 'Spring Competition', dateLabel: null, feeCents: 10000 }]}
    members={[]}
    registrations={[]}
  />
)

describe('Scholarship review — admin', () => {
  it('has the decision steps', () => {
    asAdmin(review)
    expect(screen.getByLabelText('1. Event')).toBeInTheDocument()
    expect(screen.queryByText('An admin reviews applications and makes the offer.')).toBeNull()
  })
  it('has resend, cancel and retry reimbursement', () => {
    asAdmin(<><ScholarshipResendButton id="app-1" /><ScholarshipCancelButton id="app-1" stage="awaiting_payment" /><ScholarshipRetryRefundButton id="app-1" /></>)
    expect(screen.getByRole('button', { name: 'Resend offer emails' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel scholarship…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry reimbursement' })).toBeInTheDocument()
  })
  it('edits the reviewer notes', () => {
    asAdmin(<ScholarshipNotes id="app-1" initial="Strong brief." />)
    expect(screen.getByRole('textbox', { name: 'Reviewer notes (internal only)' })).toHaveValue('Strong brief.')
  })
})

describe('Scholarship review — Staff', () => {
  it('sees no decision controls, and is told an admin decides', () => {
    asStaff(review)
    expect(screen.queryByLabelText('1. Event')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('An admin reviews applications and makes the offer.')).toBeInTheDocument()
  })
  it('sees no resend, cancel or retry, and a line instead', () => {
    asStaff(<><ScholarshipResendButton id="app-1" /><ScholarshipCancelButton id="app-1" stage="awaiting_payment" /><ScholarshipRetryRefundButton id="app-1" /></>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('An admin resends the offer emails or cancels the scholarship.')).toBeInTheDocument()
    expect(screen.getByText('An admin retries the reimbursement.')).toBeInTheDocument()
  })
  it('reads the reviewer notes but cannot edit them', () => {
    asStaff(<ScholarshipNotes id="app-1" initial="Strong brief." />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Strong brief.')).toBeInTheDocument()
    expect(screen.getByText('An admin writes the reviewer notes.')).toBeInTheDocument()
  })
})
