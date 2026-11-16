import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import type { AdminSpaceConfig } from '@/lib/space-admin'
import { FlagQueue } from './FlagQueue'
import { AdminBinaryActions } from './AdminBinaryActions'
import { ResourceUploadForm } from './ResourceUploadForm'
import { SpacesAdminList, type AdminSpaceRow } from './spaces/SpacesAdminList'
import { SpaceConfig } from './spaces/SpaceConfig'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// Community moderation, resources and Spaces are community:manage, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const flags = [
  {
    id: 'f-1', content_type: 'post' as const, content_id: 'c-1', reason: 'spam', status: 'pending', created_at: '2026-11-01T00:00:00Z',
    flagged_by_member: { first_name: 'Member', last_name: 'One', email: null }, resolved_by_member: null,
  },
]

const spaces: AdminSpaceRow[] = [
  { id: 's-1', slug: 'lounge', name: 'Propulsion Lounge', access_type: 'open', theme: 'space', postingPolicy: 'all', memberCount: 3, tierNames: [] },
]

const config: AdminSpaceConfig = {
  space: { id: 's-1', slug: 'lounge', name: 'Propulsion Lounge', description: null, access_type: 'private', theme: 'space', posting_policy: 'all', allow_member_uploads: false },
  channels: [{ id: 'ch-1', slug: 'general', name: 'general' }],
  assignedTierIds: [],
  assignedRoles: [],
  sources: [],
  members: [
    { memberId: 'm-1', name: 'Member One', email: null, tierName: null, role: 'member', status: 'active', reason: 'roster', grantRef: null, postingSuspended: false, revoked: false, addedAt: null, grantLabel: null },
  ],
  membersAreExceptions: false,
  audienceTotal: 1,
  resources: [],
  assignedTraining: [],
  trainingCatalogue: [],
  announcements: [],
  moderation: [],
}

describe('Community — admin', () => {
  it('resolves and dismisses flags', () => {
    asAdmin(<FlagQueue flags={flags} />)
    for (const name of ['Hide content', 'Resolve', 'Dismiss']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
  })
  it('adds, renames and deletes resources', () => {
    asAdmin(<><ResourceUploadForm /><AdminBinaryActions binaryId="b-1" title="Rover kit.pdf" attachedObjects={[]} /></>)
    expect(screen.getByRole('heading', { name: 'Add new resource' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Rover kit.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Rover kit.pdf' })).toBeInTheDocument()
  })
  it('creates and edits Spaces', () => {
    asAdmin(<SpacesAdminList initial={spaces} />)
    expect(screen.getByRole('button', { name: /New Space/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/admin/community/spaces/s-1')
  })
  it('changes a Space', () => {
    asAdmin(<SpaceConfig config={config} tierIdByName={{}} />)
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete space' })).toBeEnabled()
    expect(screen.queryByText(/An admin changes this Space/)).toBeNull()
  })
})

describe('Community — Staff', () => {
  it('sees flags without the moderation buttons, and is told an admin reviews them', () => {
    asStaff(<FlagQueue flags={flags} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('An admin reviews flags.')).toBeInTheDocument()
  })
  it('cannot add, rename or delete a resource', () => {
    asStaff(<><ResourceUploadForm /><AdminBinaryActions binaryId="b-1" title="Rover kit.pdf" attachedObjects={[]} /></>)
    expect(screen.queryByRole('heading', { name: 'Add new resource' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('An admin adds, renames and deletes resources.')).toBeInTheDocument()
  })
  it('sees the Spaces list with View links, and no New Space', () => {
    asStaff(<SpacesAdminList initial={spaces} />)
    expect(screen.queryByRole('button', { name: /New Space/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/admin/community/spaces/s-1')
  })
  it('reads a Space with every control disabled', () => {
    asStaff(<SpaceConfig config={config} tierIdByName={{}} />)
    expect(screen.getByText('An admin changes this Space’s settings, members and content. You can see them here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete space' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add channel/ })).toBeDisabled()
  })
  it('on a Space’s members tab: can search, cannot add a moderator, manage anyone or change posting', async () => {
    const user = userEvent.setup()
    asStaff(<SpaceConfig config={config} tierIdByName={{}} />)
    await user.click(screen.getByRole('button', { name: 'Members & permissions' }))
    expect(screen.getByText('Member One')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search this space by name or email…')).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Add moderator/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Allow file uploads in chat' })).toBeDisabled()
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled()
  })
})
