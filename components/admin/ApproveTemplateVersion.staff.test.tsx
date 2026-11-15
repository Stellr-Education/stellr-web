import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { ApproveTemplateVersion } from './ApproveTemplateVersion'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

// Approving an agreement document is esign:manage, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

describe('ApproveTemplateVersion', () => {
  it('admin: types the version name to approve', () => {
    asAdmin(<ApproveTemplateVersion id="t-1" label="minor v3" />)
    expect(screen.getByRole('heading', { name: 'Approve this version' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve and put in use' })).toBeInTheDocument()
  })
  it('Staff: no approve form, and a line saying an admin approves', () => {
    asStaff(<ApproveTemplateVersion id="t-1" label="minor v3" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('An admin approves a new version before it is used.')).toBeInTheDocument()
  })
  it('outside the admin layout (no capabilities): no approve form', () => {
    render(<ApproveTemplateVersion id="t-1" label="minor v3" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
