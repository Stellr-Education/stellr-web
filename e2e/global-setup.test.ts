// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SURVEY_EVENT_SLUG, staleSurveySlugs } from './global-setup'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const CUTOFF = NOW - 60 * 60 * 1000
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

describe('global setup: leftover survey events (deps-tailwind4.6)', () => {
  it('takes only e2e-survey events whose every row is over an hour old', () => {
    const rows = [
      { event_slug: 'e2e-survey-0a1b2c3d', created_at: at(90) },
      { event_slug: 'e2e-survey-0a1b2c3d', created_at: at(61) },
      // A distribution made 10 minutes ago: still in use, whatever its registration's age.
      { event_slug: 'e2e-survey-deadbeef', created_at: at(300) },
      { event_slug: 'e2e-survey-deadbeef', created_at: at(10) },
      { event_slug: 'e2e-survey-12345678', created_at: at(5) },
    ]
    expect(staleSurveySlugs(rows, CUTOFF)).toEqual(['e2e-survey-0a1b2c3d'])
  })

  it('never touches a slug without the exact fixture shape, however old', () => {
    const old = at(10_000)
    const rows = [
      'seed-regional-challenge',
      'e2e-survey-',
      'e2e-survey-0A1B2C3D',
      'e2e-survey-0a1b2c3d-extra',
      'x-e2e-survey-0a1b2c3d',
      'e2e-survey_0a1b2c3d',
      'e2e-surveyX0a1b2c3d',
    ].map((event_slug) => ({ event_slug, created_at: old }))
    expect(staleSurveySlugs([...rows, { event_slug: null, created_at: old }], CUTOFF)).toEqual([])
    expect(SURVEY_EVENT_SLUG.test('e2e-survey-0a1b2c3d')).toBe(true)
  })

  it('treats an unreadable timestamp as recent, so it is kept', () => {
    expect(staleSurveySlugs([{ event_slug: 'e2e-survey-0a1b2c3d', created_at: 'not a date' }], CUTOFF)).toEqual([])
  })

  it('removes through the fixture command, whose own guard refuses any other slug', () => {
    const setup = readFileSync('e2e/global-setup.ts', 'utf8')
    expect(setup).toContain("import { removeSurveyEvent } from './fixtures/survey'")
    expect(readFileSync('e2e/fixtures/survey-cli.ts', 'utf8')).toContain("if (!slug?.startsWith('e2e-survey-')) throw new Error('refusing to remove a non-e2e event')")
  })
})

describe('global setup: event-manager fixture (event-manager-e2e.4)', () => {
  const setup = readFileSync('e2e/global-setup.ts', 'utf8')

  it('writes only after the database is checked as the e2e one', () => {
    expect(setup).toMatch(/createClient\(assertE2eSupabase\(\), key,/)
  })

  it('reads the Clerk id only from a test instance, by the fixture address', () => {
    expect(setup).toContain("if (!clerkKey?.startsWith('sk_test_'))")
    expect(setup).toContain('getUserList({ emailAddress: [fixture.email] })')
  })

  it('upserts the assignment instead of inserting, so a second run changes nothing', () => {
    expect(setup).toMatch(/\.from\('event_manager_assignments'\)\s*\.upsert\(/)
    expect(setup).toContain("onConflict: 'clerk_user_id,event_slug', ignoreDuplicates: true")
  })
})
