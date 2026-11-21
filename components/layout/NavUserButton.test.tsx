import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'

// Clerk's UserButton renders its menu items as plain links here, so the test reads which
// links the menu offers for each Clerk role. Menu links only: the pages decide access.
const userMock = vi.fn()
vi.mock('@clerk/nextjs', () => {
  const UserButton = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  UserButton.MenuItems = ({ children }: { children?: ReactNode }) => <ul>{children}</ul>
  UserButton.Link = ({ label, href }: { label: string; href: string }) => (
    <li>
      <a href={href}>{label}</a>
    </li>
  )
  return { UserButton, useUser: () => userMock() }
})

const { NavUserButton } = await import('./NavUserButton')

const asRole = (role?: string) => userMock.mockReturnValue({ user: { publicMetadata: role ? { role } : {} } })
const links = () => screen.queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])

beforeEach(() => userMock.mockReset())

describe('NavUserButton: which links each role sees', () => {
  it('an admin sees the Admin panel, not the Event console', () => {
    asRole('admin')
    render(<NavUserButton />)
    expect(links()).toEqual([
      ['My Stellr', expect.stringMatching(/\/account$/)],
      ['Admin panel', '/admin'],
    ])
  })

  it('the server-passed isAdmin wins with no role in metadata', () => {
    asRole(undefined)
    render(<NavUserButton isAdmin />)
    expect(screen.getByRole('link', { name: 'Admin panel' })).toHaveAttribute('href', '/admin')
    expect(screen.queryByRole('link', { name: 'Event console' })).toBeNull()
  })

  it('Staff see the Admin panel and the Event console (Competitions opened to Staff, 21 Nov 2026)', () => {
    asRole('staff')
    render(<NavUserButton />)
    expect(links()).toEqual([
      ['My Stellr', expect.stringMatching(/\/account$/)],
      ['Admin panel', '/admin'],
      ['Event console', '/admin/competitions'],
    ])
  })

  it('an event manager sees the Event console, not the Admin panel', () => {
    asRole('event_manager')
    render(<NavUserButton />)
    expect(links()).toEqual([
      ['My Stellr', expect.stringMatching(/\/account$/)],
      ['Event console', '/admin/competitions'],
    ])
  })

  it('a member sees only My Stellr', () => {
    asRole(undefined)
    render(<NavUserButton />)
    expect(links()).toEqual([['My Stellr', expect.stringMatching(/\/account$/)]])
  })

  it('an unknown role, or no user yet, sees only My Stellr', () => {
    asRole('duty_holder')
    const { unmount } = render(<NavUserButton />)
    expect(links()).toHaveLength(1)
    unmount()
    userMock.mockReturnValue({ user: null })
    render(<NavUserButton />)
    expect(links()).toHaveLength(1)
  })
})
