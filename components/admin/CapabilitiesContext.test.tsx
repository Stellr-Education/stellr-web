import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AdminOnlyNote, Can, CapabilitiesProvider, ReadOnlyFieldset, useCan } from './CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES, type Capability } from '@/lib/authz/capabilities'

function Probe({ cap }: { cap: Capability }) {
  return <span data-testid={cap}>{useCan(cap) ? 'yes' : 'no'}</span>
}

const WRITES: Capability[] = ['store:write', 'scholarships:write', 'community:manage', 'academy:manage', 'email:manage', 'esign:manage', 'clearance:verify', 'competitions:write', 'members:write']

describe('CapabilitiesContext', () => {
  it('denies by default: with no provider, the viewer holds no capability at all', () => {
    render(<>{CAPABILITIES.map((c) => <Probe key={c} cap={c} />)}</>)
    for (const c of CAPABILITIES) expect(screen.getByTestId(c)).toHaveTextContent('no')
  })

  it('an empty set (an event manager) holds nothing either', () => {
    render(<CapabilitiesProvider capabilities={[]}>{WRITES.map((c) => <Probe key={c} cap={c} />)}</CapabilitiesProvider>)
    for (const c of WRITES) expect(screen.getByTestId(c)).toHaveTextContent('no')
  })

  it('Staff hold their set and none of the admin-only writes', () => {
    render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{CAPABILITIES.map((c) => <Probe key={c} cap={c} />)}</CapabilitiesProvider>)
    for (const c of CAPABILITIES) expect(screen.getByTestId(c)).toHaveTextContent(STAFF_CAPABILITIES.includes(c) ? 'yes' : 'no')
    for (const c of ['store:write', 'scholarships:write', 'community:manage', 'academy:manage', 'email:manage', 'esign:manage', 'clearance:verify'] as const) {
      expect(screen.getByTestId(c)).toHaveTextContent('no')
    }
  })

  it('an admin holds every capability', () => {
    render(<CapabilitiesProvider capabilities={CAPABILITIES}>{CAPABILITIES.map((c) => <Probe key={c} cap={c} />)}</CapabilitiesProvider>)
    for (const c of CAPABILITIES) expect(screen.getByTestId(c)).toHaveTextContent('yes')
  })

  it('Can shows its children to a holder and the fallback to anyone else', () => {
    const ui = <Can cap="store:write" fallback={<AdminOnlyNote>An admin adds products.</AdminOnlyNote>}><a href="/admin/store/new">New product</a></Can>
    const { unmount } = render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
    expect(screen.getByRole('link', { name: 'New product' })).toBeInTheDocument()
    unmount()
    render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)
    expect(screen.queryByRole('link', { name: 'New product' })).toBeNull()
    expect(screen.getByText('An admin adds products.')).toBeInTheDocument()
  })

  it('Can renders nothing outside a provider', () => {
    render(<Can cap="email:manage"><button type="button">Archive</button></Can>)
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
  })

  it('ReadOnlyFieldset disables the inputs and buttons inside, and leaves links working', () => {
    render(
      <ReadOnlyFieldset readOnly>
        <input aria-label="Name" />
        <button type="button">Save</button>
        <a href="/admin">Back</a>
      </ReadOnlyFieldset>,
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/admin')
  })

  it('ReadOnlyFieldset changes nothing when not read-only', () => {
    render(
      <ReadOnlyFieldset readOnly={false}>
        <button type="button">Save</button>
      </ReadOnlyFieldset>,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
