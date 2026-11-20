// Event add-ons: labels for public pages and booking screens (copy per VOICE.md).

import { formatAddonPrice } from './rules'
import { KIND_LABEL, type PublicAddon } from './types'

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "Fri, Mar 5, 2027" or "Fri, Mar 5 – Sun, Mar 7, 2027". Dates are calendar dates, so read in UTC. */
export function addonDateLabel(a: Pick<PublicAddon, 'serviceDate' | 'serviceEndDate'>): string | null {
  if (!a.serviceDate) return null
  const start = DAY.format(new Date(`${a.serviceDate}T00:00:00Z`))
  if (!a.serviceEndDate || a.serviceEndDate === a.serviceDate) return start
  return `${start} – ${DAY.format(new Date(`${a.serviceEndDate}T00:00:00Z`))}`
}

/** "$95 per person", "Free", "From $38" (merch with several prices). */
export function addonPriceLabel(a: Pick<PublicAddon, 'kind' | 'priceCents' | 'currency' | 'variants'>): string {
  if (a.kind === 'merch') {
    const prices = [...new Set(a.variants.map((v) => v.unitCents))]
    if (prices.length === 0) return ''
    const low = formatAddonPrice(Math.min(...prices), a.currency)
    return prices.length > 1 ? `From ${low}` : low
  }
  const cents = a.priceCents ?? 0
  return cents === 0 ? 'Free' : `${formatAddonPrice(cents, a.currency)} per person`
}

export function addonKindLabel(a: Pick<PublicAddon, 'kind'>): string {
  return KIND_LABEL[a.kind]
}

/** The one-line rule under a card, when there is one. */
export function addonFootnote(a: Pick<PublicAddon, 'minorsGroupOnly' | 'audience'>): string | null {
  if (a.audience === 'adults') return 'For adults only.'
  if (a.minorsGroupOnly) return 'Students under 18 book this through their school or group.'
  if (a.audience === 'students') return 'For students only.'
  return null
}
