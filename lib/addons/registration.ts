// Event add-ons chosen during registration (Phase 3 of docs/PLAN-event-add-ons-2026-11-17.md,
// US-9, US-12). The registration is saved first; then the chosen extras are booked for
// the people it named, through the same planner and capacity lock as booking later.
//
// Extras never fail a registration: a refusal (sold out, a minor's group-only night)
// comes back to the form as a message, and the place stands.
//
// Payment: an individual registrant pays for extras right after the place, from their
// own pay link (emailed, and on their account). A group puts them on its invoice
// (the one about to be issued, or an add-ons invoice: Q5), or each person pays by link.
// Extras are never in the registration's Checkout, so no code can discount them (D1).

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getEventBySlug } from '@/lib/events/repo'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { bookAddons, loadBookingContext, loadRegistrationForAddons } from './booking'
import { sendAddonPayLinks } from './notify'
import type { BookingActor, Refusal } from './plan'

export const extrasChoiceSchema = z.object({
  items: z
    .array(
      z.object({
        addonId: z.string().uuid(),
        /** Who it's for, by the email the form entered (a group), or "self" (an individual). */
        people: z.array(z.string().trim().toLowerCase().max(254)).min(1).max(200),
        variantId: z.string().uuid().nullable().optional(),
        quantity: z.number().int().min(1).max(100).optional(),
      }),
    )
    .max(50),
  payer: z.enum(['group', 'self']).default('self'),
  groupMethod: z.enum(['invoice']).nullable().optional(),
})

export type ExtrasChoice = z.infer<typeof extrasChoiceSchema>

export interface ExtrasOutcome {
  booked: number
  refusals: Refusal[]
  payLinksSent: string[]
  /** Group lines on the invoice: the caller issues or revises it. */
  invoiced: boolean
}

export async function bookExtrasAtRegistration(
  db: SupabaseClient,
  opts: { registrationId: string; actor: BookingActor; choice: unknown; bookedBy: string; bookedByMemberId: string | null },
): Promise<ExtrasOutcome> {
  const none: ExtrasOutcome = { booked: 0, refusals: [], payLinksSent: [], invoiced: false }
  const parsed = extrasChoiceSchema.safeParse(opts.choice)
  if (!parsed.success || parsed.data.items.length === 0) return none
  const registration = await loadRegistrationForAddons(db, opts.registrationId)
  // Stellr's events only (plan, "Out of scope"); NULL is a Stellr row the backfill has not reached.
  if (!registration || (registration.tenant_id ?? STELLR_TENANT_ID) !== STELLR_TENANT_ID) return none
  const ctx = await loadBookingContext(db, registration)
  const byEmail = new Map(ctx.participants.filter((p) => p.email).map((p) => [p.email!.trim().toLowerCase(), p.id]))
  const self = opts.actor.kind === 'member' ? opts.actor.participantId : null

  const items = parsed.data.items.map((i) => ({
    addonId: i.addonId,
    variantId: i.variantId ?? null,
    quantity: i.quantity,
    participantIds: i.people.map((k) => (k === 'self' && self ? self : (byEmail.get(k) ?? `unknown:${k}`))),
  }))
  const event = await getEventBySlug(registration.event_slug).catch(() => null)
  const eventDate = (event as { date?: string } | null)?.date ?? null
  const result = await bookAddons(
    db,
    ctx,
    opts.actor,
    { items, payer: parsed.data.payer, groupMethod: parsed.data.payer === 'group' ? 'invoice' : null },
    { bookedByMemberId: opts.bookedByMemberId, eventDate, actorLabel: `registration:${registration.id}` },
  )
  if (!result.ok) return { ...none, refusals: result.refusals }

  const payLinksSent = await sendAddonPayLinks(db, {
    eventSlug: registration.event_slug,
    eventTitle: registration.event_title ?? (event as { title?: string } | null)?.title ?? 'your event',
    eventDate,
    bookedBy: opts.bookedBy,
    participants: ctx.participants,
    orders: result.orders,
  })
  return { booked: result.lineIds.length, refusals: [], payLinksSent, invoiced: parsed.data.payer === 'group' }
}
