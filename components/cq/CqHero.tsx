import { Button, Hero } from '@stellr/web-ui'
import { CQ_TAGLINE } from '@/content/cq/facts'
import { FORM_ANCHOR } from './sections'

/** The Classroom Qualifier hero: headline, tagline, one CTA that carries the deadline. */
export function CqHero({
  rest,
  title,
  lead,
  cta,
  note,
}: {
  rest: string
  title: string
  lead: string
  cta: string
  note?: string
}) {
  return (
    <Hero pill={{ accent: 'Classroom Qualifier', rest }} title={title}>
      <div className="mt-5 grid gap-5">
        <p className="text-xl font-semibold tracking-heading text-hero-dim">{CQ_TAGLINE}</p>
        <p className="max-w-prose text-lg leading-relaxed text-hero-lead text-pretty">{lead}</p>
        <div className="flex flex-wrap items-center gap-3.5">
          <Button href={FORM_ANCHOR}>{cta}</Button>
        </div>
        {note && <p className="text-sm text-hero-dim">{note}</p>}
      </div>
    </Hero>
  )
}

/** A small link styled as a download action, for a step card. */
export function StepAction({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-semibold text-primary hover:bg-surface"
    >
      {label}
    </a>
  )
}
