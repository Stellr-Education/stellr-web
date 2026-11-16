import { describe, expect, it } from 'vitest'
import * as facts from './facts'
import { CQ_FAQ } from './faq'
import { CQ_RESOURCES, CQ_SUBJECT_IDEAS } from './resources'
import { CQ_SITE_FORM_SLUGS, getCqFormSource } from './form-sources'

// String values only: keys such as `campaignYear` are the CMS's field names, not copy.
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings)
  return []
}
const ALL_COPY = strings({ facts, CQ_FAQ, CQ_RESOURCES, CQ_SUBJECT_IDEAS, forms: CQ_SITE_FORM_SLUGS.map(getCqFormSource) }).join('\n')

describe('Classroom Qualifier fixed facts (V2 handover)', () => {
  it('keeps the verified stats exactly', () => {
    expect(facts.CQ_STATS.map((s) => `${s.value} ${s.label}`)).toEqual([
      '46% female',
      'More than 50% race other than White',
      '33% repeat participants',
      'Nearly 90% go on to pursue STEM or medicine',
      '1,000+ students in 10 states',
    ])
  })

  it('keeps both windows’ dates as supplied', () => {
    const fall = facts.CQ_WINDOWS['2026-27']
    const spring = facts.CQ_WINDOWS['spring-2027']
    expect([fall.opens, fall.submitBy, fall.resultsBy]).toEqual([null, '2027-01-31', '2027-01-31'])
    expect([spring.opens, spring.submitBy, spring.resultsBy]).toEqual(['2027-01-01', '2027-05-14', '2027-05-31'])
    expect(fall.cta).toBe('Get the free curriculum — due 1/31/27')
    expect(spring.cta).toBe('Get the free curriculum — due 5/14/27')
  })

  it('points visitors at fall until its deadline, then spring', () => {
    expect(facts.currentCqWindow('2026-11-16').id).toBe('2026-27')
    expect(facts.currentCqWindow('2027-01-31').id).toBe('2026-27')
    expect(facts.currentCqWindow('2027-02-01').id).toBe('spring-2027')
  })

  it('uses the handover’s fixed facts verbatim', () => {
    expect(facts.CQ_POSITIONING).toBe(
      'A free, standards-aligned engineering curriculum. Your students design a real mission, submit a proposal, and qualify for awards judged by industry professionals.',
    )
    expect(facts.CQ_TAGLINE).toBe('You bring the passion — we provide the scientists.')
    expect(facts.CQ_GRANT.body).toBe('Up to $500 + 5–10 PD hours. 15 places for 2027.')
    expect(facts.CQ_GUARANTEE_DAYS).toBe(45)
    expect(facts.CQ_TOP_PRIZE).toMatch(/fee applies/)
  })

  it('lists every file the handover names for the library', () => {
    const titles = CQ_RESOURCES.map((r) => r.title).join(' | ')
    for (const f of ['RFP', 'Mission Handbook: Space', 'Mission Handbook: Environmental', '4-week', '10-week', 'Teacher Guide', 'Student Guide', 'Judging Rubric', 'Overview deck', 'Pacing guide']) {
      expect(titles).toContain(f)
    }
  })

  it('never says campaign, uses American spelling and drops Solar Commons', () => {
    expect(ALL_COPY).not.toMatch(/campaign/i)
    expect(ALL_COPY).not.toMatch(/\b(colour|centre|programme|organis|oxidis|fertilis|autumn)/i)
    expect(ALL_COPY).not.toMatch(/solar commons/i)
  })

  it('resolves every site form to its own HubSpot source page', () => {
    const sources = CQ_SITE_FORM_SLUGS.map((s) => getCqFormSource(s)?.leadSource)
    expect(new Set(sources).size).toBe(sources.length)
    expect(getCqFormSource('mncose26')?.path).toBe('/lp/mncose26')
  })
})
