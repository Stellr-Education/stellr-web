import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// S5 C25 batch 4 (21 Nov 2026). Owner decision: Staff get the Competitions (Events) pages, as
// docs/RUNBOOK-staff-role.md says. The pages guarded with the legacy lib/event-access gate
// sent Staff to /account; they now use lib/authz requireEventAccess, which gives Staff every
// Stellr event (not as an admin). These drive the real lib/authz under AUTHZ_SOURCE unset
// (the Clerk claim): only Clerk, the database, the CMS and the redirect are stand-ins.
// Event managers keep exactly their assigned events, and a plain member is still refused.

const h = vi.hoisted(() => ({
  session: { userId: null as string | null, role: undefined as string | undefined, secondFactor: true },
  db: null as unknown as FakeDb,
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({
    userId: h.session.userId,
    sessionClaims: h.session.userId ? { metadata: { role: h.session.role } } : null,
    factorVerificationAge: h.session.userId ? [0, h.session.secondFactor ? 0 : -1] : null,
  }),
  clerkClient: async () => ({ users: { getUser: async () => ({ twoFactorEnabled: false }) } }),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/events/repo', () => ({
  getAllEvents: async () => [
    { _id: 'e1', title: 'Colorado SDC', slug: { current: 'colorado' }, date: '2027-03-06' },
    { _id: 'e2', title: 'Nevada SDC', slug: { current: 'nevada' }, date: '2027-04-10' },
  ],
  getAllCampaigns: async () => [],
  getEventBySlug: async (slug: string) => ({ title: slug === 'nevada' ? 'Nevada SDC' : 'Colorado SDC', date: '2027-03-06' }),
}))
vi.mock('@/components/admin/CheckInPoster', () => ({ default: () => <div>poster</div> }))
vi.mock('@/components/admin/EventBadges', () => ({ default: () => <div>badges</div> }))
vi.mock('@/components/admin/EventCertificates', () => ({ default: () => <div>certificates</div> }))
vi.mock('@/components/admin/PdCertificateArtwork', () => ({ default: () => <div>pd artwork</div> }))

const { default: EventsPage } = await import('./page')
const { default: ArtworkPage } = await import('./artwork/page')
const { default: PosterPage } = await import('./[slug]/check-in/poster/page')

const as = (role: string | undefined, userId: string | null = 'user_x', secondFactor = true) => {
  h.session = { userId, role, secondFactor }
}

async function outcome(run: () => Promise<React.ReactElement>): Promise<string> {
  try {
    render(await run())
    return 'rendered'
  } catch (e) {
    return e instanceof Error ? e.message : 'threw'
  }
}

beforeEach(() => {
  h.db = fakeSupabase({
    event_manager_assignments: [{ clerk_user_id: 'user_em', event_slug: 'colorado' }],
    registrations: [],
    event_settings: [],
  })
})

describe('the Events list (/admin/competitions)', () => {
  it('Staff sees every event, and the default artwork link (owner decision, 21 Nov 2026)', async () => {
    as('staff', 'user_staff')
    expect(await outcome(() => EventsPage())).toBe('rendered')
    expect(screen.getByRole('link', { name: 'Colorado SDC' })).toHaveAttribute('href', '/admin/competitions/colorado')
    expect(screen.getByRole('link', { name: 'Nevada SDC' })).toBeInTheDocument()
    expect(screen.getByText('All events and campaigns from the CMS')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Default artwork' })).toBeInTheDocument()
  })

  it('an admin sees every event, as before', async () => {
    as('admin', 'user_admin')
    expect(await outcome(() => EventsPage())).toBe('rendered')
    expect(screen.getByRole('link', { name: 'Nevada SDC' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Default artwork' })).toBeInTheDocument()
  })

  it('an event manager sees only their assigned event, and no default artwork link', async () => {
    as('event_manager', 'user_em')
    expect(await outcome(() => EventsPage())).toBe('rendered')
    expect(screen.getByRole('link', { name: 'Colorado SDC' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nevada SDC' })).toBeNull()
    expect(screen.getByText('Events you are assigned to manage')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Default artwork' })).toBeNull()
  })

  it('a plain member is still refused, and signed out goes to sign in', async () => {
    as('member', 'user_member')
    expect(await outcome(() => EventsPage())).toBe('REDIRECT /account')
    as(undefined, null)
    expect(await outcome(() => EventsPage())).toBe('REDIRECT /sign-in')
  })

  it('Staff with no second factor on the session is refused, as a member is', async () => {
    as('staff', 'user_staff', false)
    expect(await outcome(() => EventsPage())).toBe('REDIRECT /account')
  })
})

describe('Default artwork (/admin/competitions/artwork)', () => {
  const run = () => ArtworkPage({ searchParams: Promise.resolve({}) })

  it('opens to admins and Staff', async () => {
    as('admin', 'user_admin')
    expect(await outcome(run)).toBe('rendered')
    as('staff', 'user_staff')
    expect(await outcome(run)).toBe('rendered')
  })

  it('sends an event manager back to the list, and refuses a member', async () => {
    as('event_manager', 'user_em')
    expect(await outcome(run)).toBe('REDIRECT /admin/competitions')
    as('member', 'user_member')
    expect(await outcome(run)).toBe('REDIRECT /admin')
  })
})

describe('an event page (/admin/competitions/[slug]/check-in/poster)', () => {
  const run = (slug: string) => () => PosterPage({ params: Promise.resolve({ slug }) })

  it('Staff reaches any Stellr event', async () => {
    as('staff', 'user_staff')
    expect(await outcome(run('nevada'))).toBe('rendered')
    expect(screen.getByRole('heading', { name: /Nevada SDC/ })).toBeInTheDocument()
  })

  it('an event manager reaches their own event only', async () => {
    as('event_manager', 'user_em')
    expect(await outcome(run('colorado'))).toBe('rendered')
    expect(await outcome(run('nevada'))).toBe('REDIRECT /admin/competitions')
  })

  it('a plain member is refused', async () => {
    as('member', 'user_member')
    expect(await outcome(run('colorado'))).toBe('REDIRECT /admin/competitions')
  })
})
