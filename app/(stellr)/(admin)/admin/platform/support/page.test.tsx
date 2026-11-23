import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// S6-SUP-UI: the support view. Platform admins only; with no verified session it reads
// nothing; inside one it reads only through tenantSupportDb, never the service client.

const h = vi.hoisted(() => ({
  platformAdmin: true,
  enabled: true,
  session: null as null | { mode: 'read' | 'break_glass'; tenantId: string; tenantName: string },
  supportDbThrows: false,
  supportDbCalls: [] as string[],
}))
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)

vi.mock('next/navigation', () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/authz', () => ({
  authz: { page: { requireStellrAdmin: vi.fn(async () => undefined) } },
  assertPlatformAdmin: async () => (h.platformAdmin ? { ok: true } : { ok: false, status: 403 }),
}))
vi.mock('@/lib/authz/support-session', () => ({ supportModeEnabled: () => h.enabled }))
vi.mock('@/lib/authz/support-session-server', () => ({ loadSupportSession: async () => h.session }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    throw new Error('the support view must never use the service client')
  },
}))
vi.mock('@/lib/tenancy/support-db', () => ({
  tenantSupportDb: (s: { tenantId: string }) => {
    if (h.supportDbThrows) throw new Error('TENANT_DB_ENABLED is off')
    h.supportDbCalls.push(s.tenantId)
    return { tenantId: s.tenantId }
  },
}))
vi.mock('@/lib/support/read-view', () => ({
  supportEvents: async () => [{ slug: 'bravo-2027', title: 'Bravo Challenge', status: 'published', startsAt: '2027-03-01 09:00:00+00', registrations: 12, participants: 40 }],
  supportEventCompanies: async () => [{ id: 'c1', number: 1, name: 'Comets', participants: 6 }],
}))
vi.mock('@/components/admin/SupportCompanyRename', () => ({ SupportCompanyRename: ({ name }: { name: string | null }) => <span>rename {name}</span> }))

const { default: SupportViewPage } = await import('./page')
const page = (event?: string) => SupportViewPage({ searchParams: Promise.resolve(event ? { event } : {}) })

beforeEach(() => {
  Object.assign(h, { platformAdmin: true, enabled: true, supportDbThrows: false })
  h.session = null
  h.supportDbCalls = []
  notFound.mockClear()
})

describe('SupportViewPage', () => {
  it('a Stellr admin who is not a platform admin, or support mode off: 404', async () => {
    h.platformAdmin = false
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND')
    h.platformAdmin = true
    h.enabled = false
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('no session: explains how to open one, and reads nothing', async () => {
    render(await page())
    expect(screen.getByText(/don’t have a support session open/)).toBeInTheDocument()
    expect(h.supportDbCalls).toEqual([])
  })

  it('a read session: the session tenant’s events through tenantSupportDb, read-only', async () => {
    h.session = { mode: 'read', tenantId: 'tenant-b', tenantName: 'Bravo Org' }
    render(await page('bravo-2027'))
    expect(screen.getByText('Support view: Bravo Org')).toBeInTheDocument()
    expect(screen.getByText('Bravo Challenge')).toBeInTheDocument()
    expect(screen.getByText('Read-only. Nothing here can be changed.')).toBeInTheDocument()
    expect(screen.getByText('Comets')).toBeInTheDocument()
    expect(screen.queryByText(/rename/)).toBeNull()
    expect(h.supportDbCalls).toEqual(['tenant-b'])
  })

  it('break-glass: offers the rename', async () => {
    h.session = { mode: 'break_glass', tenantId: 'tenant-b', tenantName: 'Bravo Org' }
    render(await page('bravo-2027'))
    expect(screen.getByText('rename Comets')).toBeInTheDocument()
  })

  it('the tenant database not set up: says so, and never falls back', async () => {
    h.session = { mode: 'read', tenantId: 'tenant-b', tenantName: 'Bravo Org' }
    h.supportDbThrows = true
    render(await page())
    expect(screen.getByRole('alert')).toHaveTextContent(/tenant database connection isn’t set up/)
  })
})
