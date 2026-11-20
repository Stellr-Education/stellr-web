// Event add-ons: pure rules (no database), so each one is unit-tested on its own.

import { z } from 'zod'
import { ADDON_AUDIENCES, ADDON_KINDS, ADDON_STATUSES, REFUND_RULES, type AddonRow, type PublicAddon } from './types'

/** Is the add-on on sale at `now`: status on_sale and inside its sales window? */
export function onSale(a: Pick<AddonRow, 'status' | 'sale_opens_at' | 'sale_closes_at'>, now: Date = new Date()): boolean {
  if (a.status !== 'on_sale') return false
  if (a.sale_opens_at && new Date(a.sale_opens_at).getTime() > now.getTime()) return false
  if (a.sale_closes_at && new Date(a.sale_closes_at).getTime() <= now.getTime()) return false
  return true
}

/** Shown publicly: on sale, or closed/sold out but still worth listing (not draft or archived). */
export function publiclyListed(a: Pick<AddonRow, 'status'>): boolean {
  return a.status === 'on_sale' || a.status === 'closed'
}

/** Availability without ever exposing a count. */
export function availability(capacity: number | null, taken: number): PublicAddon['availability'] {
  if (capacity == null) return 'available'
  const left = capacity - taken
  if (left <= 0) return 'sold_out'
  if (left <= 5) return 'limited'
  return 'available'
}

/** When a line stops being refundable, by the add-on's rule (FR-12). null: never refundable. */
export function refundDeadline(a: Pick<AddonRow, 'refund_rule' | 'refund_until' | 'sale_closes_at'>): Date | 'event_policy' | null {
  if (a.refund_rule === 'none') return null
  if (a.refund_rule === 'event_policy') return 'event_policy'
  const at = a.refund_until ?? a.sale_closes_at
  return at ? new Date(at) : new Date(8.64e15)
}

/** Is a line of this add-on refundable at `now`? Merch also needs its batch uncommitted (checked by the caller). */
export function refundableNow(a: Pick<AddonRow, 'refund_rule' | 'refund_until' | 'sale_closes_at'>, now: Date = new Date()): boolean | 'event_policy' {
  const d = refundDeadline(a)
  if (d === null) return false
  if (d === 'event_policy') return 'event_policy'
  return now.getTime() < d.getTime()
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Not a date and time')
const text = (max: number) => z.string().trim().max(max)

/** Staff input for creating or editing an add-on (admin routes). */
export const addonInputSchema = z
  .object({
    kind: z.enum(ADDON_KINDS),
    title: text(200).min(1, 'A title is required'),
    description: text(2000).default(''),
    includes: z.array(text(200).min(1)).max(20).default([]),
    serviceDate: isoDate.nullable().default(null),
    serviceEndDate: isoDate.nullable().default(null),
    priceCents: z.number().int().min(0).max(10_000_000).nullable().default(null),
    capacity: z.number().int().min(0).max(100_000).nullable().default(null),
    saleOpensAt: isoTime.nullable().default(null),
    saleClosesAt: isoTime.nullable().default(null),
    audience: z.enum(ADDON_AUDIENCES).default('all'),
    refundRule: z.enum(REFUND_RULES).default('until_cutoff'),
    refundUntil: isoTime.nullable().default(null),
    requiresAddendum: z.boolean().default(false),
    minorsGroupOnly: z.boolean().optional(),
    maxPerPerson: z.number().int().min(1).max(100).optional(),
    storeProductId: z.string().uuid().nullable().default(null),
    variantIds: z.array(z.string().uuid()).max(50).default([]),
    displayGroup: text(100).nullable().default(null),
    sort: z.number().int().min(-1000).max(1000).default(0),
    status: z.enum(ADDON_STATUSES).default('draft'),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'merch') {
      if (!v.storeProductId) ctx.addIssue({ code: 'custom', path: ['storeProductId'], message: 'Pick a store product for merch' })
      if (v.variantIds.length === 0) ctx.addIssue({ code: 'custom', path: ['variantIds'], message: 'Pick at least one size' })
    } else {
      if (v.priceCents == null) ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'A price is required (0 for free)' })
      if (v.priceCents != null && v.priceCents > 0 && v.priceCents < 50)
        ctx.addIssue({ code: 'custom', path: ['priceCents'], message: 'Card payments need at least $0.50' })
    }
    if (v.serviceDate && v.serviceEndDate && v.serviceEndDate < v.serviceDate)
      ctx.addIssue({ code: 'custom', path: ['serviceEndDate'], message: 'Ends before it starts' })
    if (v.saleOpensAt && v.saleClosesAt && Date.parse(v.saleClosesAt) <= Date.parse(v.saleOpensAt))
      ctx.addIssue({ code: 'custom', path: ['saleClosesAt'], message: 'Sales close before they open' })
  })

export type AddonInput = z.infer<typeof addonInputSchema>

/** The database row an input becomes. Kind-specific defaults: accommodation is group-only for minors. */
export function rowFromInput(input: AddonInput): Omit<AddonRow, 'id' | 'event_slug' | 'currency' | 'variant_ids'> {
  const merch = input.kind === 'merch'
  return {
    kind: input.kind,
    title: input.title,
    description: input.description,
    includes: input.includes,
    service_date: input.serviceDate,
    service_end_date: input.serviceEndDate,
    price_cents: merch ? null : input.priceCents,
    capacity: merch ? null : input.capacity,
    sale_opens_at: input.saleOpensAt,
    sale_closes_at: input.saleClosesAt,
    audience: input.audience,
    refund_rule: input.refundRule,
    refund_until: input.refundUntil,
    requires_addendum: input.requiresAddendum,
    minors_group_only: input.minorsGroupOnly ?? input.kind === 'accommodation',
    max_per_person: merch ? (input.maxPerPerson ?? 10) : 1,
    store_product_id: merch ? input.storeProductId : null,
    display_group: input.displayGroup || null,
    sort: input.sort,
    status: input.status,
  }
}

/** "$45" / "$45.50" / "AUD 45" — the event price style (lib/event-pricing.ts). */
export function formatAddonPrice(cents: number, currency: string): string {
  if (cents === 0) return 'Free'
  const whole = cents % 100 === 0
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
  return currency.toLowerCase() === 'usd' ? `$${n}` : `${currency.toUpperCase()} ${n}`
}
