// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S5 wave 8, K11 canary probe P4 (PR #759): Stellr's pages read an event from the CMS by
// slug alone, and the CMS holds every tenant's event documents, so dev-canary's register
// page was served on Stellr's host. Each Stellr page that shows one event by slug now asks
// the events mirror whose event it is (lib/events/stellr-owner.ts, C20c's read): another
// tenant's event answers as a slug nobody has, a failed owner read throws to the error
// boundary, and Stellr's own events render as ever (test/flow-pages-golden.test.tsx pins
// the bytes of the flow pages; the owner check for those sits in a layout beside them).

const STELLR = '00000000-0000-4000-8000-000000000001'
const OTHER_TENANT = '00000000-0000-4000-8000-0000000000aa'

const state = vi.hoisted(() => ({
  event: null as Record<string, unknown> | null,
  owner: null as { tenant_id: string | null } | null,
  ownerError: null as { message: string } | null,
  ownerReads: 0,
  registration: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => state.event }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.ownerReads++
            return { data: state.owner, error: state.ownerError }
          },
        }),
      }),
    }),
  }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => ({ id: 'member-1', first_name: 'Ada', hasPaidTier: false }) }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: async () => state.registration }))
vi.mock('@/components/registration/RegistrationAuthBanner', () => ({ RegistrationAuthBanner: () => null }))
vi.mock('@/components/registration/StepBar', () => ({ StepBar: () => null }))
vi.mock('@/components/campaigns/QualifierUpgradePrompt', () => ({ QualifierUpgradePrompt: () => null }))
vi.mock('@/components/campaigns/SubmitProposalForm', () => ({ SubmitProposalForm: () => null }))

const EVENT = { title: 'Canary Challenge', activityType: 'competition', date: '2027-03-01', registrationOpenDate: '2020-01-01' }
const CAMPAIGN = { title: 'Canary Campaign', activityType: 'campaign', type: 'design competition' }

const params = { params: Promise.resolve({ slug: 'some-event' }) }

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'rendered'
  } catch (err) {
    return (err as Error).message
  }
}

beforeEach(() => {
  state.event = EVENT
  state.owner = null
  state.ownerError = null
  state.ownerReads = 0
  state.registration = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const withCode = { searchParams: Promise.resolve({ c: 'p.placeholder.sig' }) }
const checkInPage = async () =>
  (await import('@/app/(stellr)/(flow)/check-in/[slug]/page')).default({ ...params, searchParams: Promise.resolve({}) }) as Promise<{ props: Record<string, unknown> }>
const checkInCodePage = async () =>
  (await import('@/app/(stellr)/(flow)/check-in/[slug]/code/page')).default({ ...params, ...withCode }) as Promise<{ props: { searchParams: Promise<{ c?: string }> } }>
const registerTypePage = async () => (await import('@/app/(stellr)/(flow)/register/[slug]/page')).default(params)
const individualLayout = async () =>
  (await import('@/app/(stellr)/(flow)/register/[slug]/individual/layout')).default({ children: 'form', ...params })
const groupLayout = async () =>
  (await import('@/app/(stellr)/(flow)/register/[slug]/group/layout')).default({ children: 'form', ...params })
const campaignPage = async () => (await import('@/app/(stellr)/(member)/campaigns/[slug]/page')).default(params)
const campaignSubmitPage = async () => (await import('@/app/(stellr)/(member)/campaigns/[slug]/submit/page')).default(params)

describe('/register/[slug]', () => {
  it("answers another tenant's event with the not-found a missing event gets", async () => {
    state.owner = { tenant_id: OTHER_TENANT }
    expect(await outcome(registerTypePage)).toBe('NEXT_NOT_FOUND')
    state.event = null
    state.owner = null
    expect(await outcome(registerTypePage)).toBe('NEXT_NOT_FOUND')
  })

  it("renders Stellr's own event, mirrored or not", async () => {
    expect(await outcome(registerTypePage)).toBe('rendered')
    state.owner = { tenant_id: STELLR }
    expect(await outcome(registerTypePage)).toBe('rendered')
  })

  it('throws a failed owner read to the error boundary, never a 404', async () => {
    state.ownerError = { message: 'connection reset' }
    expect(await outcome(registerTypePage)).toBe('The event owner could not be read')
  })

  it('reads no owner for a slug the CMS does not have', async () => {
    state.event = null
    await outcome(registerTypePage)
    expect(state.ownerReads).toBe(0)
  })
})

describe('/check-in/[slug] and its code page (A12, canary probe P6)', () => {
  it("the check-in page: another tenant's event is not found; Stellr's, or an unmirrored slug, renders its body", async () => {
    state.owner = { tenant_id: OTHER_TENANT }
    expect(await outcome(checkInPage)).toBe('NEXT_NOT_FOUND')
    state.owner = { tenant_id: STELLR }
    expect(await outcome(checkInPage)).toBe('rendered')
    state.owner = null
    expect(await outcome(checkInPage)).toBe('rendered')
  })

  it("the code page: another tenant's event gets the body with no code, as a slug nobody has; Stellr's gets its code", async () => {
    state.owner = { tenant_id: OTHER_TENANT }
    expect(await (await checkInCodePage()).props.searchParams).toEqual({})
    state.owner = { tenant_id: STELLR }
    expect(await (await checkInCodePage()).props.searchParams).toEqual({ c: 'p.placeholder.sig' })
  })

  it('a failed owner read throws, never a 404', async () => {
    state.ownerError = { message: 'connection reset' }
    expect(await outcome(checkInPage)).toBe('The event owner could not be read')
    expect(await outcome(checkInCodePage)).toBe('The event owner could not be read')
  })
})

describe('/register/[slug]/individual and /group, through their layouts', () => {
  for (const [name, layout] of [['individual', individualLayout], ['group', groupLayout]] as const) {
    it(`${name}: another tenant's event is not found, Stellr's renders its page untouched`, async () => {
      state.owner = { tenant_id: OTHER_TENANT }
      expect(await outcome(layout)).toBe('NEXT_NOT_FOUND')
      state.owner = { tenant_id: STELLR }
      expect(await layout()).toBe('form')
      state.owner = null
      expect(await layout()).toBe('form')
    })

    it(`${name}: a failed owner read throws, never a 404`, async () => {
      state.ownerError = { message: 'connection reset' }
      expect(await outcome(layout)).toBe('The event owner could not be read')
    })
  }
})

describe('/campaigns/[slug] and its submit page', () => {
  for (const [name, page] of [['workspace', campaignPage], ['submit', campaignSubmitPage]] as const) {
    it(`${name}: another tenant's campaign is not found, before the registration redirect`, async () => {
      state.event = CAMPAIGN
      state.owner = { tenant_id: OTHER_TENANT }
      expect(await outcome(page)).toBe('NEXT_NOT_FOUND')
    })

    it(`${name}: Stellr's own campaign goes on as before`, async () => {
      state.event = CAMPAIGN
      state.owner = { tenant_id: STELLR }
      // Not registered, so the page sends the member to the public page, as it always has.
      expect(await outcome(page)).toBe('NEXT_REDIRECT /events/some-event')
    })
  }
})

// Every Stellr page that reads one event by slug either checks the owner itself, or sits
// under a layout that does, or is listed here with the slice that owns it.
const OWNED_ELSEWHERE: Record<string, string> = {
  // Answered by their token's row (A7, e2e/tenancy/host-cases.ts: sameAsUnknown). The
  // event read feeds the analytics title or the grade band, not the page's record.
  'app/(stellr)/(flow)/register/[slug]/confirmation/page.tsx': 'A7',
  'app/(stellr)/(flow)/register/[slug]/join/[token]/page.tsx': 'A7',
  'app/(stellr)/(flow)/register/[slug]/pay-seat/[token]/page.tsx': 'A7',
}

function pagesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((rel) => rel.endsWith('page.tsx'))
    .map((rel) => join(dir, rel).split('\\').join('/'))
}

const checks = (src: string) => /\b(requireStellrEvent|isStellrEvent)\(/.test(src)

describe('every Stellr page that shows one event by slug checks its owner', () => {
  it('in the page, in a layout above it, or by a named slice', () => {
    const unchecked: string[] = []
    for (const page of pagesUnder('app/(stellr)')) {
      // Admin pages are behind requireEventAccess, which decides on the event's tenant.
      if (page.includes('/(admin)/')) continue
      const dir = dirname(page)
      const own = [page, ...readdirSync(dir).filter((f) => f.endsWith('-body.tsx')).map((f) => join(dir, f))]
      if (!own.some((f) => readFileSync(f, 'utf8').includes('getEventBySlug('))) continue
      if (OWNED_ELSEWHERE[page]) continue
      let covered = checks(readFileSync(page, 'utf8'))
      for (let d = dir; !covered && d.startsWith('app/(stellr)'); d = dirname(d)) {
        try {
          covered = checks(readFileSync(join(d, 'layout.tsx'), 'utf8'))
        } catch {
          // no layout at this level
        }
      }
      if (!covered) unchecked.push(page)
    }
    expect(unchecked).toEqual([])
  })

  it('the named slices list only pages that read an event', () => {
    for (const page of Object.keys(OWNED_ELSEWHERE)) {
      const dir = dirname(page)
      const own = [page, ...readdirSync(dir).filter((f) => f.endsWith('-body.tsx')).map((f) => join(dir, f))]
      expect(own.some((f) => readFileSync(f, 'utf8').includes('getEventBySlug(')), page).toBe(true)
    }
  })
})
