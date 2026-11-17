// @stellr/web-ui TierTable — a membership ladder, side by side.
import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from './primitives'
import { tierButtonColor, tierShade, type TierId } from './tier-shades'
import { GuaranteeBadge } from './Guarantee'

export interface TierTableTier {
  id: TierId
  name: string
  /** What the tier gets you, in a few words ("Full material & PD hours"). Named first, before the price. */
  role: string
  /** Display price ("Free", "$149"); omit when no live price resolved. */
  price?: string | null
  /** Beside the price ("always", "per year"). */
  priceNote?: string
  highlights: string[]
  featured?: boolean
  cta?: { label: string; href: string }
}

/**
 * Every tier of one ladder, side by side: one column per tier on a wide
 * screen, stacked on a phone. Tiers are named by what you get (`role`) before
 * the price, and the money-back guarantee sits under the ladder whenever
 * `guaranteeDays` is given, because a guarantee belongs beside the price.
 *
 * Data in, markup out: prices come from the caller (never typed here), and
 * the router's link goes in as `linkAs`.
 */
export function TierTable({
  tiers,
  caption,
  guaranteeDays,
  guaranteeHref,
  linkAs,
  className,
}: {
  tiers: TierTableTier[]
  /** Accessible name for the ladder. */
  caption: string
  guaranteeDays?: number
  guaranteeHref?: string
  linkAs?: React.ElementType
  className?: string
}) {
  const Link = (linkAs ?? 'a') as React.ElementType
  return (
    <div className={cn('grid gap-5', className)}>
      <ul aria-label={caption} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((t) => (
          <li
            key={t.id}
            className={cn(
              'relative flex flex-col overflow-hidden rounded-ds-card bg-white p-5 pt-6',
              t.featured ? 'border-2 border-primary shadow-featured' : 'border border-line',
            )}
          >
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: tierShade(t.id) }} />
            <h3 className="font-display text-xl font-bold text-ink">{t.name}</h3>
            <p className="mt-1 text-sm font-semibold text-content-secondary">{t.role}</p>
            {t.price && (
              <p className="mt-3 font-display text-2xl font-bold" style={{ color: tierButtonColor(t.id) }}>
                {t.price}
                {t.priceNote && (
                  <span className="ml-1.5 font-sans text-sm font-normal text-content-muted">{t.priceNote}</span>
                )}
              </p>
            )}
            <ul className="mt-4 grid flex-1 content-start gap-2">
              {t.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2 text-sm text-ink">
                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {h}
                </li>
              ))}
            </ul>
            {t.cta && (
              <Link
                href={t.cta.href}
                className="mt-5 inline-flex items-center justify-center rounded-control border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
              >
                {t.cta.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {guaranteeDays != null && (
        <GuaranteeBadge days={guaranteeDays} href={guaranteeHref} linkAs={linkAs} variant="compact" />
      )}
    </div>
  )
}
