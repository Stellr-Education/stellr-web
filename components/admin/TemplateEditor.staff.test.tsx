import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { TemplateEditor } from './TemplateEditor'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// Adding and editing agreement documents is esign:manage, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const editor = <TemplateEditor documentKey="minor" title="" pdfPath={null} fields={[]} roles={[]} fromVersion={null} keys={['minor', 'adult']} />

describe('TemplateEditor', () => {
  it('admin: uploads a PDF and saves a version', () => {
    asAdmin(editor)
    expect(screen.getByRole('button', { name: 'Save as new version' })).toBeInTheDocument()
    expect(screen.getByText('Upload the agreement PDF to start.')).toBeInTheDocument()
  })
  it('Staff: no editor, and a line saying an admin edits documents', () => {
    asStaff(editor)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('An admin adds and edits agreement documents.')).toBeInTheDocument()
  })
})
