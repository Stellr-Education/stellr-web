import * as React from 'react'
import { Check } from 'lucide-react'
import { cn, Eyebrow } from './primitives'

/* ── AddonCard ────────────────────────────────────────────────────────────────
 * One optional extra on an event page: accommodation, an experience or event
 * merch. The app formats the price and dates; the card only lays them out.
 * `availability` never carries a count: "limited" reads as "Few places left". */
export type AddonAvailability = 'available' | 'limited' | 'sold_out'

export function AddonCard({
  kindLabel,
  title,
  priceLabel,
  dateLabel,
  description,
  includes = [],
  availability = 'available',
  footnote,
  className,
}: {
  kindLabel: string
  title: string
  priceLabel: string
  dateLabel?: string | null
  description?: string | null
  includes?: string[]
  availability?: AddonAvailability
  /** A short line under the card, e.g. "Booked after you register" or a group-only rule. */
  footnote?: React.ReactNode
  className?: string
}) {
  const soldOut = availability === 'sold_out'
  return (
    <article className={cn('flex h-full flex-col rounded-ds-card border border-line bg-white p-5', soldOut && 'opacity-75', className)}>
      <div className="flex items-start justify-between gap-3">
        <Eyebrow>{kindLabel}</Eyebrow>
        {availability !== 'available' && (
          <span
            className={cn(
              'shrink-0 rounded-pill px-2.5 py-0.5 text-xs font-semibold',
              soldOut ? 'bg-surface text-content-muted' : 'bg-pathway-amber-bg text-gold-ink',
            )}
          >
            {soldOut ? 'Sold out' : 'Few places left'}
          </span>
        )}
      </div>
      <h3 className="mt-1 font-heading text-lg font-bold text-ink">{title}</h3>
      {dateLabel && <p className="text-sm text-content-muted">{dateLabel}</p>}
      {description && <p className="mt-2 text-sm text-content-body">{description}</p>}
      {includes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {includes.map((i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-content-body">
              <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              <span>{i}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto pt-4 font-heading text-xl font-bold text-ink">{priceLabel}</p>
      {footnote && <p className="mt-1 text-xs text-content-muted">{footnote}</p>}
    </article>
  )
}
