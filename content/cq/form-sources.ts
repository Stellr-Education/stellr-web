import { getCurriculumLandingPage } from '@/content/lp'
import type { CurriculumLandingPageConfig } from '@/content/lp/cq-types'
import { CQ_WINDOWS, type CqWindowId } from './facts'

/**
 * Every page that carries the curriculum request form, and what it reports to
 * HubSpot. One form (cq-curriculum-request), told apart by `lp_source_page`
 * (handover §3.5: "one form with lead_source").
 *
 * /api/cq-lead accepts only slugs this resolves, so the reporting key stays
 * clean.
 */
export interface CqFormSource {
  slug: string
  /** Page path, for HubSpot's pageUri. */
  path: string
  /** HubSpot `lp_source_page`. */
  leadSource: string
  /** HubSpot `cq_window`. */
  window: CqWindowId
  pageName: string
  form: CurriculumLandingPageConfig['form']
}

const SUCCESS_BODY =
  'Create your free Educator account to download the RFP, Mission Handbook, schedules, ' +
  'guides and Judging Rubric.'

function formFor(window: CqWindowId): CqFormSource['form'] {
  return {
    eyebrow: 'Free curriculum',
    heading: 'Get the curriculum',
    lead: 'Teachers only: we never ask for student details here.',
    submitLabel: 'Send me the curriculum',
    consentLabel: 'I agree to Stellr Education emailing me about the Classroom Qualifier.',
    success: {
      heading: 'You’re in. Here’s your curriculum.',
      body: `${SUCCESS_BODY} Your team’s proposal is due ${CQ_WINDOWS[window].submitByLabel}.`,
      accountCta: 'Create my free Educator account',
    },
  }
}

const SITE_SOURCES: CqFormSource[] = [
  {
    slug: 'cq-hub',
    path: '/classroom-qualifier',
    leadSource: 'cq-hub',
    window: '2026-27',
    pageName: 'Classroom Qualifier',
    form: formFor('2026-27'),
  },
  {
    slug: 'cq-2026-27',
    path: CQ_WINDOWS['2026-27'].path,
    leadSource: 'cq-2026-27',
    window: '2026-27',
    pageName: 'Classroom Qualifier 2026–27',
    form: formFor('2026-27'),
  },
  {
    slug: 'cq-spring-2027',
    path: CQ_WINDOWS['spring-2027'].path,
    leadSource: 'cq-spring-2027',
    window: 'spring-2027',
    pageName: 'Classroom Qualifier Spring 2027',
    form: formFor('spring-2027'),
  },
  {
    slug: 'cq-resources',
    path: '/classroom-qualifier/resources',
    leadSource: 'cq-resources',
    window: '2026-27',
    pageName: 'Classroom Qualifier curriculum library',
    form: formFor('2026-27'),
  },
]

const BY_SLUG: Record<string, CqFormSource> = Object.fromEntries(SITE_SOURCES.map((s) => [s.slug, s]))

export type CqSiteFormSlug = 'cq-hub' | 'cq-2026-27' | 'cq-spring-2027' | 'cq-resources'

export function getSiteFormSource(slug: CqSiteFormSlug): CqFormSource {
  return BY_SLUG[slug]
}

/** A site page's form source, or a curriculum landing page's, or undefined. */
export function getCqFormSource(slug: string): CqFormSource | undefined {
  if (BY_SLUG[slug]) return BY_SLUG[slug]
  const lp = getCurriculumLandingPage(slug)
  if (!lp) return undefined
  return {
    slug: lp.slug,
    path: `/lp/${lp.slug}`,
    leadSource: lp.leadSource,
    window: lp.window,
    pageName: lp.seo.title,
    form: lp.form,
  }
}

export const CQ_SITE_FORM_SLUGS = SITE_SOURCES.map((s) => s.slug)
