import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { EmailManager } from './EmailManager'
import type { EmailCampaign, EmailTemplate } from './types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

// Admin email campaigns and templates are email:manage, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const templates: EmailTemplate[] = [{ id: 'tpl-1', key: 'welcome', name: 'Welcome', subject: 'Welcome aboard', body_json: null, updated_at: '2026-11-01T00:00:00Z' }]
const campaigns: EmailCampaign[] = [{
  id: 'c-1', name: 'November update', trigger_type: 'scheduled', scheduled_at: '2026-11-20T15:00:00Z', event_key: null, delay_days: 0,
  sequence_key: null, status: 'draft', audience: {}, sent_at: null, created_at: '2026-11-01T00:00:00Z', templateName: 'Welcome',
}]
const manager = <EmailManager templates={templates} campaigns={campaigns} tiers={[]} />

describe('Admin email — admin', () => {
  it('creates, tests, starts and archives campaigns', () => {
    asAdmin(manager)
    for (const name of ['Test', 'Activate', 'Archive']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(screen.queryByText('An admin creates, tests, starts and pauses campaigns.')).toBeNull()
  })
})

describe('Admin email — Staff', () => {
  it('sees campaigns without the form or the row actions', () => {
    asStaff(manager)
    expect(screen.getByText('November update')).toBeInTheDocument()
    for (const name of ['Test', 'Activate', 'Archive']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByText('An admin creates, tests, starts and pauses campaigns.')).toBeInTheDocument()
  })
  it('sees templates without the form or archive', async () => {
    const user = userEvent.setup()
    asStaff(manager)
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByText('Welcome aboard', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
    expect(screen.getByText('An admin creates and archives templates.')).toBeInTheDocument()
  })
})
