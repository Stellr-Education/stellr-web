import type { Metadata } from 'next'
import { Button, CtaBand, StepCard } from '@stellr/web-ui'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'
import { CqHero, StepAction } from '@/components/cq/CqHero'
import {
  CqFaq,
  CqFormSection,
  DatesAtAGlance,
  FORM_ANCHOR,
  GrantCard,
  NeededAndIncluded,
  Proof,
  QualifierTierTable,
  Section,
  ThemeCards,
} from '@/components/cq/sections'
import { CQ_FAQ } from '@/content/cq/faq'
import { CQ_POSITIONING, CQ_TOP_PRIZE, currentCqWindow } from '@/content/cq/facts'
import { getSiteFormSource } from '@/content/cq/form-sources'

export const metadata: Metadata = {
  alternates: { canonical: '/classroom-qualifier' },
  title: { absolute: 'Classroom Qualifier: Free Engineering Curriculum for Grades 7–12 | Stellr' },
  description:
    'A free, standards-aligned engineering curriculum for grades 7–12. Your students design a real ' +
    'mission, submit a proposal, and qualify for awards judged by industry professionals.',
}

export const revalidate = 21600

const RESOURCES = '/classroom-qualifier/resources'

export default function ClassroomQualifierHub() {
  const win = currentCqWindow()
  const source = getSiteFormSource('cq-hub')

  const steps = [
    {
      title: 'Get the curriculum',
      body: 'Free. Fill in the form and download the full pack.',
      action: <StepAction href={FORM_ANCHOR} label="Download the full pack" />,
    },
    {
      title: 'Pick a theme and a window',
      body: 'Space Mission Design or Environmental Design; fall or spring.',
      action: <StepAction href={`${RESOURCES}#library`} label="Download the overview deck" />,
    },
    {
      title: 'Run it in class',
      body: '4–10 weeks, in class, after school or as a club.',
      action: <StepAction href={`${RESOURCES}#library`} label="Download the schedules" />,
    },
    {
      title: 'Submit a proposal',
      body: 'One 10–20 page team proposal, by the deadline for your window.',
      action: <StepAction href={`${RESOURCES}#library`} label="Download the Student Guide" />,
    },
    {
      title: 'Industry judges score it',
      body: 'Three equally weighted criteria. Every team gets written feedback.',
      action: <StepAction href={`${RESOURCES}#library`} label="Download the Judging Rubric" />,
    },
  ]

  return (
    <>
      <TrackEvent event={{ event: 'lp_view', lp_audience: 'classroom_qualifier_teacher', page_slug: source.slug }} />

      <CqHero
        rest="Grades 7–12"
        title="A free engineering curriculum that ends with industry judges"
        lead={CQ_POSITIONING}
        cta={win.cta}
      />

      <DatesAtAGlance />

      <ThemeCards hrefFor={(anchor) => `${win.path}#${anchor}`} />

      <NeededAndIncluded tone="surface" />

      <Section labelledBy="steps-h">
        <h2 id="steps-h" className="font-display text-3xl font-bold tracking-heading text-ink">
          Steps to enter
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.title}>
              <StepCard n={i + 1} title={s.title} body={s.body} action={s.action} />
            </li>
          ))}
        </ol>
        <p className="mt-6 max-w-prose text-ds-body font-semibold text-ink">{CQ_TOP_PRIZE}</p>
      </Section>

      <QualifierTierTable />

      <section aria-label="Teacher Grant" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <GrantCard />
        </div>
      </section>

      <Proof />

      <CqFormSection source={source} />

      <CqFaq items={CQ_FAQ} />

      <CtaBand
        title={`Free curriculum. Real judges. Due ${win.submitByLabel}.`}
        body="Start anytime this school year."
        actions={<Button href={FORM_ANCHOR}>{win.cta}</Button>}
      />

      <section aria-label="How Stellr is funded" className="bg-white px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <MissionFundingNote variant="general" />
        </div>
      </section>
    </>
  )
}
