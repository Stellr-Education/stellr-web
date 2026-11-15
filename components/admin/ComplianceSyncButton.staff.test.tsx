import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { ComplianceSyncButton } from './ComplianceSyncButton'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

// Syncing checks can clear people, so it is clearance:verify, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

describe('ComplianceSyncButton', () => {
  it('admin: syncs with Checkr', () => {
    asAdmin(<ComplianceSyncButton />)
    expect(screen.getByRole('button', { name: 'Sync with Checkr' })).toBeInTheDocument()
  })
  it('Staff: no sync button, and a line saying an admin syncs', () => {
    asStaff(<ComplianceSyncButton />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('An admin syncs checks with Checkr.')).toBeInTheDocument()
  })
})
