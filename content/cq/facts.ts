/**
 * Classroom Qualifier — the fixed facts, in one place.
 *
 * Source: the owner's V2 handover ("Revised Plan v3", 13 Nov 2026), "Fixed
 * facts". Verbatim where it says so. Do not add numbers that are not there:
 * content/cq/facts.test.ts pins the stats and the dates.
 *
 * Open with the owner (handover §1): the fall window's submission deadline and
 * its feedback + awards date are both 1/31/27 as supplied. Shown as given.
 */

export const CQ_POSITIONING =
  'A free, standards-aligned engineering curriculum. Your students design a real mission, ' +
  'submit a proposal, and qualify for awards judged by industry professionals.'

export const CQ_TAGLINE = 'You bring the passion — we provide the scientists.'

export type CqWindowId = '2026-27' | 'spring-2027'

export interface CqWindow {
  id: CqWindowId
  /** Route under /classroom-qualifier. */
  path: string
  /** Display name: "2026–27 (fall)". */
  name: string
  /** Sanity `season` + `campaignYear` that belong to this window. */
  season: 'fall' | 'spring'
  campaignYear: number
  /** ISO dates. `opens` null = start anytime. */
  opens: string | null
  submitBy: string
  resultsBy: string
  /** US display strings (handover: 1/31/27). */
  opensLabel: string
  submitByLabel: string
  resultsByLabel: string
  /** The CTA carries the deadline. */
  cta: string
}

export const CQ_WINDOWS: Record<CqWindowId, CqWindow> = {
  '2026-27': {
    id: '2026-27',
    path: '/classroom-qualifier/2026-27',
    name: '2026–27 (fall)',
    season: 'fall',
    campaignYear: 2027,
    opens: null,
    submitBy: '2027-01-31',
    resultsBy: '2027-01-31',
    opensLabel: 'Start anytime',
    submitByLabel: '1/31/27',
    resultsByLabel: '1/31/27',
    cta: 'Get the free curriculum — due 1/31/27',
  },
  'spring-2027': {
    id: 'spring-2027',
    path: '/classroom-qualifier/spring-2027',
    name: 'Spring 2027',
    season: 'spring',
    campaignYear: 2027,
    opens: '2027-01-01',
    submitBy: '2027-05-14',
    resultsBy: '2027-05-31',
    opensLabel: 'Opens 1/1/27',
    submitByLabel: '5/14/27',
    resultsByLabel: '5/31/27',
    cta: 'Get the free curriculum — due 5/14/27',
  },
}

export const CQ_WINDOW_ORDER: CqWindowId[] = ['2026-27', 'spring-2027']

/**
 * The window a visitor should be pointed at today: the fall window until its
 * deadline has passed, then spring. Dates compare as ISO strings.
 */
export function currentCqWindow(today: string = new Date().toISOString().slice(0, 10)): CqWindow {
  return today <= CQ_WINDOWS['2026-27'].submitBy ? CQ_WINDOWS['2026-27'] : CQ_WINDOWS['spring-2027']
}

export type CqThemeId = 'space' | 'enviro'

export const CQ_THEMES: { id: CqThemeId; anchor: string; name: string; body: string }[] = [
  {
    id: 'space',
    anchor: 'space',
    name: 'Space Mission Design',
    body: 'Students plan a settlement beyond Earth and defend every design choice in their proposal.',
  },
  {
    id: 'enviro',
    anchor: 'environmental',
    name: 'Environmental Design',
    body: 'Students engineer solutions to real-world environmental problems, here on Earth.',
  },
]

/** Verified stats only (handover §0). Do not add to this list. */
export const CQ_STATS = [
  { value: '46%', label: 'female' },
  { value: 'More than 50%', label: 'race other than White' },
  { value: '33%', label: 'repeat participants' },
  { value: 'Nearly 90%', label: 'go on to pursue STEM or medicine' },
  { value: '1,000+', label: 'students in 10 states' },
] as const

/** Cleared quotes, verbatim from stellreducation.org. */
export const CQ_TESTIMONIALS = [
  {
    quote:
      'There’s no other forum available for school-aged students to learn about real-world ' +
      'work. These events should be mandatory for every student, globally.',
    who: 'Senior Aerospace Executive and Competition Judge',
  },
  {
    quote: 'I didn’t know what I wanted to study when I left high school. Now I am laser focused.',
    who: 'Aiden · 2025 Competition Participant',
  },
] as const

export const CQ_GRANT = {
  heading: 'Teacher Grant',
  body: 'Up to $500 + 5–10 PD hours. 15 places for 2027.',
} as const

export const CQ_TOP_PRIZE =
  'Winning teams are invited to the 2027 International Summer Camp at NASA Johnson Space Center, ' +
  'Houston. A camp fee applies.'

export const CQ_GUARANTEE_DAYS = 45

/** "What's needed?" (handover §3.2). */
export const CQ_NEEDED = [
  'A teacher',
  '2–12 students per team',
  '4–10 weeks',
  'Internet access',
  'No engineering background',
] as const

/** What every entrant gets (handover §3.2). PD hours depend on tier. */
export const CQ_EVERY_ENTRANT = [
  'Written feedback from industry judges',
  'A Stellr certificate',
  'PD hours for the teacher (by membership tier)',
] as const
