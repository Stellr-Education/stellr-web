import { Eyebrow, TierTable, type TierTableTier } from '@stellr/web-ui'
import { Environment, Orbit } from '@stellr/icons'
import { Check } from 'lucide-react'
import Link from '@/components/ui/SiteLink'
import { FaqList } from '@/components/lp/FaqList'
import { CurriculumLeadForm } from '@/components/lp/CurriculumLeadForm'
import { VoiceQuote } from '@/components/lp/sections/Reasons'
import { standardsSentence } from '@/components/lp/CurriculumLandingPage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFaqJsonLd } from '@/lib/structured-data'
import { formatTierPrice, getTierPriceMap } from '@/lib/tier-pricing'
import { getTeacherStories } from '@/lib/teacher-stories'
import { AUDIENCES, educatorTierHighlights } from '@/app/(stellr)/(public)/membership/tier-data'
import type { LpFaqItem } from '@/content/lp/types'
import type { CqFormSource } from '@/content/cq/form-sources'
import {
  CQ_EVERY_ENTRANT,
  CQ_GRANT,
  CQ_GUARANTEE_DAYS,
  CQ_NEEDED,
  CQ_POSITIONING,
  CQ_STATS,
  CQ_TESTIMONIALS,
  CQ_THEMES,
  CQ_WINDOW_ORDER,
  CQ_WINDOWS,
} from '@/content/cq/facts'

/**
 * The Classroom Qualifier page sections, shared by the hub, the two window
 * pages and the curriculum library. Same family as the /lp curriculum page:
 * dark hero, light body, one form at #get-curriculum that every CTA points at.
 */

export const FORM_ANCHOR = '#get-curriculum'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

const H2 = 'font-display text-3xl font-bold tracking-heading text-ink'

export function Section({
  id,
  labelledBy,
  tone = 'white',
  children,
}: {
  id?: string
  labelledBy: string
  tone?: 'white' | 'surface'
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={`scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8 ${tone === 'surface' ? 'bg-surface' : 'bg-white'}`}
    >
      <div className="mx-auto max-w-content">{children}</div>
    </section>
  )
}

/** Both windows, side by side (handover §3.2). */
export function DatesAtAGlance({ tone = 'surface' }: { tone?: 'white' | 'surface' }) {
  return (
    <Section labelledBy="dates-h" tone={tone}>
      <h2 id="dates-h" className={H2}>
        Dates at a glance
      </h2>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-left text-ds-body">
          <thead>
            <tr className="border-b border-line text-ds-meta text-content-muted">
              <th scope="col" className="py-2 pr-4 font-semibold">Window</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Start</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Submit by</th>
              <th scope="col" className="py-2 font-semibold">Feedback + awards by</th>
            </tr>
          </thead>
          <tbody>
            {CQ_WINDOW_ORDER.map((id) => {
              const w = CQ_WINDOWS[id]
              return (
                <tr key={id} className="border-b border-line">
                  <th scope="row" className="py-3 pr-4 font-semibold text-ink">
                    <Link href={w.path} className="text-primary underline underline-offset-2 hover:no-underline">
                      {w.name}
                    </Link>
                  </th>
                  <td className="py-3 pr-4 text-ink">{w.opensLabel}</td>
                  <td className="py-3 pr-4 font-semibold text-ink">{w.submitByLabel}</td>
                  <td className="py-3 text-ink">{w.resultsByLabel}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

/** The two themes. `hrefFor` sends a card to a window page's theme anchor. */
export function ThemeCards({
  heading = 'Two themes. Teachers pick one.',
  hrefFor,
  tone = 'white',
}: {
  heading?: string
  hrefFor?: (anchor: string) => string
  tone?: 'white' | 'surface'
}) {
  return (
    <Section labelledBy="themes-h" tone={tone}>
      <h2 id="themes-h" className={H2}>
        {heading}
      </h2>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {CQ_THEMES.map((t) => {
          const space = t.id === 'space'
          const Icon = space ? Orbit : Environment
          const body = (
            <>
              <span
                className={`inline-flex h-11 w-11 items-center justify-center rounded-ds-card text-white ${space ? 'bg-space-violet' : 'bg-enviro-green'}`}
              >
                <Icon aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-display text-xl font-bold text-ink">{t.name}</h3>
              <p className="mt-2 text-ds-body leading-relaxed text-content-secondary">{t.body}</p>
            </>
          )
          const cls = `block rounded-panel border-2 bg-white p-6 ${space ? 'border-space-violet' : 'border-enviro-green'}`
          return hrefFor ? (
            <Link key={t.id} href={hrefFor(t.anchor)} className={`${cls} hover:shadow-card-lift`}>
              {body}
            </Link>
          ) : (
            <div key={t.id} className={cls}>
              {body}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function CheckList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-6 grid gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-ds-body text-ink">
          <Check aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          {item}
        </li>
      ))}
    </ul>
  )
}

/** "What's needed?" beside "What every entrant gets". */
export function NeededAndIncluded({ tone = 'white' }: { tone?: 'white' | 'surface' }) {
  return (
    <Section labelledBy="needed-h" tone={tone}>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 id="needed-h" className={H2}>
            What’s needed?
          </h2>
          <CheckList items={CQ_NEEDED} />
        </div>
        <div>
          <h2 className={H2}>What every entrant gets</h2>
          <CheckList items={CQ_EVERY_ENTRANT} />
        </div>
      </div>
    </Section>
  )
}

/** The teacher ladder, priced live from membership_tiers. */
export async function QualifierTierTable({ tone = 'surface' }: { tone?: 'white' | 'surface' }) {
  const prices = await getTierPriceMap().catch(() => ({}) as Awaited<ReturnType<typeof getTierPriceMap>>)
  const tiers: TierTableTier[] = AUDIENCES.educator.tiers.map((t, i) => {
    const price = prices[t.name]
    return {
      id: t.id,
      name: t.name,
      role: t.role,
      price: price ? formatTierPrice(price) : t.free ? 'Free' : null,
      priceNote: t.priceNote,
      featured: t.id === 'catalyst',
      highlights: t.free ? ['The Classroom Qualifier curriculum', ...educatorTierHighlights(i, 3)] : educatorTierHighlights(i, 4),
      cta: t.free
        ? { label: 'Start free', href: `${AUTH_URL}/sign-up` }
        : { label: `Compare ${t.name}`, href: `/membership#${t.id}` },
    }
  })
  return (
    <Section id="tiers" labelledBy="tiers-h" tone={tone}>
      <h2 id="tiers-h" className={H2}>
        Free to start. Upgrade anytime.
      </h2>
      <p className="mt-2 text-ds-body text-content-secondary">
        The curriculum is free. Paid tiers add more material, live support and PD hours.
      </p>
      <TierTable
        className="mt-8"
        caption="Teacher membership tiers"
        tiers={tiers}
        guaranteeDays={CQ_GUARANTEE_DAYS}
        guaranteeHref="/terms#guarantee"
        linkAs={Link}
      />
    </Section>
  )
}

export function GrantCard() {
  return (
    <div className="rounded-panel border border-pathway-amber bg-pathway-amber-bg p-6">
      <h2 className="font-display text-xl font-bold text-ink">{CQ_GRANT.heading}</h2>
      <p className="mt-2 text-ds-body leading-relaxed text-ink">{CQ_GRANT.body}</p>
      <a href={FORM_ANCHOR} className="mt-3 inline-block font-semibold text-primary underline">
        Tick “I’m interested in the Teacher Grant” on the form
      </a>
    </div>
  )
}

/** Verified stats + cleared testimonials (handover §0). */
export async function Proof({ heading = 'Why teachers run it' }: { heading?: string }) {
  // The stories link appears only once a story has been cleared in Sanity.
  const stories = await getTeacherStories()
  const storiesHref = stories.length > 0 ? '/classroom-qualifier/stories' : null
  return (
    <Section labelledBy="proof-h" tone="surface">
      <h2 id="proof-h" className={H2}>
        {heading}
      </h2>
      <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {CQ_STATS.map((s) => (
          <div key={s.label} className="rounded-ds-card border border-line bg-white p-4">
            <dt className="sr-only">{s.label}</dt>
            <dd className="font-display text-2xl font-bold text-primary">{s.value}</dd>
            <dd className="mt-1 text-ds-meta text-content-secondary">{s.label}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {CQ_TESTIMONIALS.map((q) => (
          <figure key={q.who} className="m-0">
            <VoiceQuote accent="space" className="mt-0 h-full px-6 py-6">
              <span className="block font-display text-lg font-medium leading-snug">“{q.quote}”</span>
              <figcaption className="mt-3 text-ds-meta font-semibold">{q.who}</figcaption>
            </VoiceQuote>
          </figure>
        ))}
      </div>
      {storiesHref && (
        <Link href={storiesHref} className="mt-6 inline-block font-semibold text-primary underline">
          Read teacher stories
        </Link>
      )}
    </Section>
  )
}

/** The one form. */
export function CqFormSection({ source }: { source: CqFormSource }) {
  return (
    <section
      id="get-curriculum"
      aria-labelledby="form-h"
      className="scroll-mt-20 bg-midnight px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="mx-auto grid max-w-content gap-8 lg:grid-cols-2">
        <div className="text-white">
          <Eyebrow className="text-hero-dim">{source.form.eyebrow}</Eyebrow>
          <h2 id="form-h" className="mt-2.5 font-display text-3xl font-bold tracking-heading">
            {source.form.heading}
          </h2>
          <p className="mt-3 text-hero-lead">{CQ_POSITIONING}</p>
        </div>
        <CurriculumLeadForm config={source} />
      </div>
    </section>
  )
}

/** FAQ, rendered and as FAQPage JSON-LD from the same strings. */
export function CqFaq({ items, heading = 'Questions teachers ask' }: { items: LpFaqItem[]; heading?: string }) {
  const standards = standardsSentence()
  const filled = items.map((i) => ({ ...i, a: i.a.replace('{{standards}}', standards) }))
  return (
    <section aria-labelledby="faq-h" id="faq" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <JsonLd data={buildFaqJsonLd(filled.map((item) => ({ q: item.q, text: item.a })))} />
      <div className="mx-auto grid max-w-content gap-8 lg:grid-cols-3 lg:gap-12">
        <h2 id="faq-h" className={H2}>
          {heading}
        </h2>
        <div className="lg:col-span-2">
          <FaqList items={filled} />
        </div>
      </div>
    </section>
  )
}
