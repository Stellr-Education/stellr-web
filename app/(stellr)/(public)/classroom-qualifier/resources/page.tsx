import type { Metadata } from 'next'
import { Button, CtaBand } from '@stellr/web-ui'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { CqHero } from '@/components/cq/CqHero'
import { CurriculumLibrary } from '@/components/cq/CurriculumLibrary'
import { CqFormSection, FORM_ANCHOR, QualifierTierTable, Section } from '@/components/cq/sections'
import { CQ_TAGLINE, currentCqWindow } from '@/content/cq/facts'
import { getSiteFormSource } from '@/content/cq/form-sources'

export const metadata: Metadata = {
  alternates: { canonical: '/classroom-qualifier/resources' },
  title: { absolute: 'Classroom Qualifier Curriculum Library: RFP, Handbooks, Schedules | Stellr' },
  description:
    'The free Classroom Qualifier curriculum for grades 7–12: the RFP, Mission Handbooks, 4- and 10-week ' +
    'schedules, pacing guide, Teacher and Student Guides, Judging Rubric and overview deck, with ideas by subject.',
}

export const revalidate = 21600

const APP_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

export default function CurriculumLibraryPage() {
  const win = currentCqWindow()
  const source = getSiteFormSource('cq-resources')
  return (
    <>
      <TrackEvent event={{ event: 'lp_view', lp_audience: 'classroom_qualifier_teacher', page_slug: source.slug }} />

      <CqHero
        rest="Curriculum library"
        title="Everything you need to run the Classroom Qualifier"
        lead="The RFP, Mission Handbooks, schedules, guides, Judging Rubric and overview deck. Free with an Educator account."
        cta={win.cta}
        note={CQ_TAGLINE}
      />

      <Section id="library" labelledBy="library-h" tone="surface">
        <h2 id="library-h" className="font-display text-3xl font-bold tracking-heading text-ink">
          The curriculum library
        </h2>
        <p className="mt-2 max-w-prose text-ds-body text-content-secondary">
          Filter by theme, subject and grade. The whole pack comes as one download once you fill in the form.
        </p>
        <div className="mt-8">
          <CurriculumLibrary appUrl={APP_URL} />
        </div>
      </Section>

      <CqFormSection source={source} />

      <QualifierTierTable tone="white" />

      <CtaBand
        title={`Free curriculum. Real judges. Due ${win.submitByLabel}.`}
        body="Start anytime this school year."
        actions={<Button href={FORM_ANCHOR}>{win.cta}</Button>}
      />
    </>
  )
}
