import { Button, CtaBand } from '@stellr/web-ui'
import { Environment, Orbit } from '@stellr/icons'
import Link from '@/components/ui/SiteLink'
import { TrackEvent } from '@/components/analytics/TrackEvent'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'
import { getAllCampaigns } from '@/lib/events/repo'
import { campaignStatus, themeFromType } from '@/lib/campaigns'
import type { StellarEvent } from '@/lib/sanity'
import { CqHero } from './CqHero'
import {
  CqFaq,
  CqFormSection,
  FORM_ANCHOR,
  GrantCard,
  NeededAndIncluded,
  Proof,
  QualifierTierTable,
  Section,
} from './sections'
import { CQ_FAQ } from '@/content/cq/faq'
import { CQ_POSITIONING, CQ_THEMES, CQ_TOP_PRIZE, CQ_WINDOWS, type CqWindowId } from '@/content/cq/facts'
import { getSiteFormSource } from '@/content/cq/form-sources'

const H2 = 'font-display text-3xl font-bold tracking-heading text-ink'

/**
 * One Classroom Qualifier window (handover §3.1): its dates, both themes with
 * their team registration, and the curriculum form.
 *
 * The dates are the handover's fixed facts (content/cq/facts.ts). Sanity says
 * which theme documents exist for the window and whether their registration is
 * open; the old /events/<slug> pages for those documents 301 here.
 */
export async function WindowPage({ id }: { id: CqWindowId }) {
  const win = CQ_WINDOWS[id]
  const source = getSiteFormSource(id === '2026-27' ? 'cq-2026-27' : 'cq-spring-2027')
  const all = ((await getAllCampaigns().catch(() => null)) ?? []) as StellarEvent[]
  const docs = all.filter((c) => c.season === win.season && c.campaignYear === win.campaignYear)

  const glance = [
    { value: win.opensLabel, label: 'Start' },
    { value: `Submit by ${win.submitByLabel}`, label: 'One 10–20 page team proposal' },
    { value: `By ${win.resultsByLabel}`, label: 'Feedback + awards' },
    { value: 'Grades 7–12', label: '2–12 students per team' },
    { value: '4–10 weeks', label: 'In class, after school or as a club' },
  ]

  return (
    <>
      <TrackEvent event={{ event: 'lp_view', lp_audience: 'classroom_qualifier_teacher', page_slug: source.slug }} />

      <CqHero
        rest={win.name}
        title={`Classroom Qualifier ${win.name}: submit by ${win.submitByLabel}`}
        lead={CQ_POSITIONING}
        cta={win.cta}
      />

      <section aria-labelledby="glance-h" className="bg-surface px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <h2 id="glance-h" className="sr-only">
            At a glance
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {glance.map((g) => (
              <li key={g.label} className="rounded-ds-card border border-line bg-white p-4">
                <p className="font-display text-lg font-bold text-ink">{g.value}</p>
                <p className="mt-1 text-ds-meta text-content-secondary">{g.label}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Section labelledBy="themes-h">
        <h2 id="themes-h" className={H2}>
          Two themes. Teachers pick one.
        </h2>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {CQ_THEMES.map((t) => {
            const space = t.id === 'space'
            const Icon = space ? Orbit : Environment
            const doc = docs.find((d) => themeFromType(d.type) === t.id)
            const open = doc ? campaignStatus(doc) === 'Open' : false
            return (
              <article
                key={t.id}
                id={t.anchor}
                className={`scroll-mt-20 rounded-panel border-2 bg-white p-6 ${space ? 'border-space-violet' : 'border-enviro-green'}`}
              >
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-ds-card text-white ${space ? 'bg-space-violet' : 'bg-enviro-green'}`}
                >
                  <Icon aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-display text-xl font-bold text-ink">{t.name}</h3>
                <p className="mt-2 text-ds-body leading-relaxed text-content-secondary">{t.body}</p>
                <p className="mt-4 text-ds-meta font-semibold text-ink">
                  Submit by {win.submitByLabel} · Feedback + awards by {win.resultsByLabel}
                </p>
                {doc && open ? (
                  <Link
                    href={`/register/${doc.slug.current}/group`}
                    className="mt-4 inline-block font-semibold text-primary underline underline-offset-2 hover:no-underline"
                  >
                    Already have the curriculum? Register your team
                  </Link>
                ) : (
                  <p className="mt-4 text-ds-meta text-content-muted">
                    {win.opens ? `Team registration opens ${win.opensLabel.replace('Opens ', '')}.` : 'Team registration opens soon.'}{' '}
                    Get the curriculum now and start planning.
                  </p>
                )}
              </article>
            )
          })}
        </div>
      </Section>

      <NeededAndIncluded tone="surface" />

      <Section labelledBy="judging-h">
        <h2 id="judging-h" className={H2}>
          How it’s judged
        </h2>
        <p className="mt-3 max-w-prose text-ds-body leading-relaxed text-content-secondary">
          Industry professionals score every proposal against three equally weighted criteria, set out in the Judging
          Rubric that comes with the curriculum. Every team gets written feedback.
        </p>
        <p className="mt-4 font-semibold text-ink">Feedback and awards by {win.resultsByLabel}.</p>
        <p className="mt-2 max-w-prose text-ds-body text-ink">{CQ_TOP_PRIZE}</p>
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
        body={
          id === '2026-27'
            ? 'Start anytime this school year.'
            : 'The spring window opens 1/1/27. Get the curriculum now and plan ahead.'
        }
        actions={<Button href={FORM_ANCHOR}>{win.cta}</Button>}
      />

      <section aria-label="Other window and how Stellr is funded" className="bg-white px-4 pb-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-content gap-4">
          <p className="text-ds-body text-ink">
            {id === '2026-27' ? 'Missed 1/31/27? ' : 'Ready sooner? '}
            <Link
              href={id === '2026-27' ? CQ_WINDOWS['spring-2027'].path : CQ_WINDOWS['2026-27'].path}
              className="font-semibold text-primary underline"
            >
              {id === '2026-27' ? 'See the Spring 2027 window' : 'See the 2026–27 window'}
            </Link>
          </p>
          <MissionFundingNote variant="general" />
        </div>
      </section>
    </>
  )
}
