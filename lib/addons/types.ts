// Event add-ons: shared types (docs/PLAN-event-add-ons-2026-11-17.md).
//
// An add-on is an optional extra an event offers on top of a place:
// accommodation (one row per night), an experience (a tour) or merch (a store
// product, sized at booking). Dependency-free so client components can import it.

export const ADDON_KINDS = ['accommodation', 'experience', 'merch'] as const
export type AddonKind = (typeof ADDON_KINDS)[number]

export const ADDON_STATUSES = ['draft', 'on_sale', 'closed', 'archived'] as const
export type AddonStatus = (typeof ADDON_STATUSES)[number]

export const ADDON_AUDIENCES = ['students', 'adults', 'all'] as const
export type AddonAudience = (typeof ADDON_AUDIENCES)[number]

export const REFUND_RULES = ['until_cutoff', 'event_policy', 'none'] as const
export type RefundRule = (typeof REFUND_RULES)[number]

/** Line statuses that hold a place against capacity. */
export const LIVE_LINE_STATUSES = ['pending_payment', 'pending_consent', 'confirmed'] as const
export type LineStatus = 'pending_payment' | 'pending_consent' | 'confirmed' | 'cancelled' | 'refunded' | 'expired'
export type LinePayer = 'group' | 'self' | 'included' | 'offline'
export type GroupMethod = 'card' | 'invoice'

/** Merch quantity cap per item in one order (Q13c). Staff can lift it. */
export const MERCH_MAX_PER_ORDER = 10

export interface AddonRow {
  id: string
  event_slug: string
  kind: AddonKind
  title: string
  description: string
  includes: string[]
  service_date: string | null
  service_end_date: string | null
  price_cents: number | null
  currency: string
  capacity: number | null
  sale_opens_at: string | null
  sale_closes_at: string | null
  audience: AddonAudience
  refund_rule: RefundRule
  refund_until: string | null
  requires_addendum: boolean
  minors_group_only: boolean
  max_per_person: number
  store_product_id: string | null
  variant_ids: string[]
  display_group: string | null
  sort: number
  status: AddonStatus
}

/** A merch size on sale, priced for this event. */
export interface AddonVariant {
  variantId: string
  label: string
  sku: string
  unitCents: number
}

/** What public pages and booking screens see of an add-on. No personal data. */
export interface PublicAddon {
  id: string
  kind: AddonKind
  title: string
  description: string
  includes: string[]
  serviceDate: string | null
  serviceEndDate: string | null
  /** Accommodation and experiences; for merch, the lowest variant price. */
  priceCents: number | null
  currency: string
  displayGroup: string | null
  audience: AddonAudience
  maxPerPerson: number
  minorsGroupOnly: boolean
  requiresAddendum: boolean
  saleClosesAt: string | null
  /** 'available', 'limited' (5 or fewer left) or 'sold_out'. Never a count. */
  availability: 'available' | 'limited' | 'sold_out'
  variants: AddonVariant[]
}

export interface AddonSettings {
  merchUpsell: boolean
  inclusions: string[]
}

export const DEFAULT_ADDON_SETTINGS: AddonSettings = { merchUpsell: true, inclusions: [] }

export const KIND_LABEL: Record<AddonKind, string> = {
  accommodation: 'Accommodation',
  experience: 'Experience',
  merch: 'Event merch',
}
