// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// deep review PUB-9: a Sanity fetch error was swallowed to null and rendered as
// notFound() — i.e. an outage/timeout became a 404, de-indexing a live event
// URL. The fix distinguishes "no such event" (null → notFound) from "fetch
// failed" (throw → the error boundary / a retryable 500).

const { getEventBySlug, owner } = vi.hoisted(() => ({
  getEventBySlug: vi.fn(),
  owner: { row: null as { tenant_id: string } | null, error: null as { message: string } | null },
}))
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug,
  urlFor: () => ({ width: () => ({ height: () => ({ url: () => '' }) }) }),
}))
// The events mirror, for the owner read (S5 K11 probe P4).
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: owner.row, error: owner.error }) }) }),
    }),
  }),
}))
vi.mock('@/lib/schema-series', () => ({ getSeriesMembers: async () => [] }))
vi.mock('@/lib/campaign-registrations', () => ({
  getMemberCampaignContext: async () => ({ membership: null, registeredSlugs: new Set() }),
}))
vi.mock('@/lib/event-pricing', () => ({
  getEventPrice: async () => ({ kind: 'unavailable' }),
  eventPriceLabel: () => null,
}))
// Component + rich-text modules — never rendered in these branches, mocked only
// so the page module imports cleanly in a node test.
vi.mock('next-sanity', () => ({ PortableText: () => null }))
vi.mock('@/components/campaigns/CampaignDetail', () => ({ CampaignDetail: () => null }))
vi.mock('@/components/sections/EventCtas', () => ({ EventHeroCtas: () => null, EventNotifyButton: () => null }))
vi.mock('@/components/sections/EventFlyers', () => ({ EventFlyers: () => null }))
vi.mock('@/components/ui/CardPills', () => ({ CardPills: () => null }))
vi.mock('@/components/analytics/TrackEvent', () => ({ TrackEvent: () => null }))
vi.mock('@/components/ui/MissionFundingNote', () => ({ MissionFundingNote: () => null }))

const { default: Page, generateMetadata } = await import('./page')

const render = () => Page({ params: Promise.resolve({ slug: 'nevada-2027' }) })

beforeEach(() => {
  vi.clearAllMocks()
  owner.row = null
  owner.error = null
})

describe('event detail page — Sanity error vs not-found (PUB-9)', () => {
  it('re-throws a Sanity fetch error instead of 404ing', async () => {
    getEventBySlug.mockRejectedValueOnce(new Error('sanity 503'))
    await expect(render()).rejects.toThrow('sanity 503')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('still 404s a genuinely missing event (null)', async () => {
    getEventBySlug.mockResolvedValueOnce(null)
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })
})

// S5 wave 8, K11 canary probe P4: the CMS holds every tenant's event documents, so the
// page asks the events mirror whose event it is before showing it (lib/events/stellr-owner).
describe("event detail page — another tenant's event (P4)", () => {
  const OTHER_TENANT = '00000000-0000-4000-8000-0000000000aa'
  const TENANT_EVENT = { title: 'Canary Challenge', activityType: 'competition' }
  const metadata = () => generateMetadata({ params: Promise.resolve({ slug: 'dev-canary-event' }) })

  it("404s another tenant's event, the same as a missing one", async () => {
    getEventBySlug.mockResolvedValueOnce(TENANT_EVENT)
    owner.row = { tenant_id: OTHER_TENANT }
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it("gives another tenant's event the missing event's metadata, with nothing of its title", async () => {
    getEventBySlug.mockResolvedValueOnce(TENANT_EVENT)
    owner.row = { tenant_id: OTHER_TENANT }
    expect(await metadata()).toEqual({ title: 'Event Not Found' })
  })

  it("keeps Stellr's own event's metadata, mirrored or not", async () => {
    getEventBySlug.mockResolvedValue({ title: 'Nevada Design Challenge', activityType: 'competition', tagline: 'Build it.' })
    owner.row = null
    const unmirrored = await metadata()
    owner.row = { tenant_id: '00000000-0000-4000-8000-000000000001' }
    expect(await metadata()).toEqual(unmirrored)
    expect(unmirrored.title).toBe('Nevada Design Challenge — In-Person STEM Competition')
    getEventBySlug.mockReset()
  })

  it('re-throws a failed owner read instead of 404ing or showing the event', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getEventBySlug.mockResolvedValue(TENANT_EVENT)
    owner.error = { message: 'connection reset' }
    await expect(render()).rejects.toThrow('The event owner could not be read')
    await expect(metadata()).rejects.toThrow('The event owner could not be read')
    expect(notFound).not.toHaveBeenCalled()
    getEventBySlug.mockReset()
  })
})
