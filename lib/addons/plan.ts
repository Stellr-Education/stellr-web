// Event add-ons: who may book what for whom, at what price (Phase 2 of
// docs/PLAN-event-add-ons-2026-11-17.md). Pure: the route loads the facts, this
// decides, and lib/addons/booking.ts writes. Every refusal carries a complete
// message for the person booking, never a bare code (FR-5a).

import { isAdultRole } from '@/lib/group-payer'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { onSale } from './rules'
import type { AddonRow, AddonVariant, GroupMethod, LinePayer, LineStatus } from './types'

export type BookingActor =
  | { kind: 'staff' }
  | { kind: 'organiser'; role: 'teacher' | 'teacher_poc' | 'student_manager' }
  | { kind: 'member'; participantId: string }

export interface PlanParticipant {
  id: string
  first_name: string
  event_role: string | null
  date_of_birth: string | null
}

export interface PlanRegistration {
  id: string
  type: string
  status: string
  event_slug: string
}

export interface PlanAddon extends AddonRow {
  variants: AddonVariant[]
}

export interface BookingItem {
  addonId: string
  participantIds: string[]
  variantId?: string | null
  quantity?: number
}

export interface BookingRequest {
  items: BookingItem[]
  payer: LinePayer
  groupMethod?: GroupMethod | null
  /** Staff only: let a minor on an individual registration book a group-only add-on (FR-5a). */
  overrideMinorRule?: boolean
}

export interface PlannedLine {
  addonId: string
  participantId: string
  variantId: string | null
  quantity: number
  unitPriceCents: number
  currency: string
  payer: LinePayer
  groupMethod: GroupMethod | null
  status: LineStatus
  minorRuleOverride: boolean
  /** A minor's line waiting for the overnight and off-site addendum once paid (FR-5b). */
  needsAddendum: boolean
}

export interface Refusal {
  code: string
  message: string
  addonId?: string
  participantId?: string
}

export interface LiveLine {
  addon_id: string
  participant_id: string
  variant_id: string | null
}

export const MINOR_INDIVIDUAL_ACCOMMODATION = 'addon_minor_individual_accommodation'

/** The full FR-5a message: what, why, and what to do. */
export function minorIndividualMessage(addonTitle: string): string {
  return (
    `${addonTitle} is only available to students under 18 who are travelling with a school or group. ` +
    'An overnight stay needs a responsible adult from the student’s own group. ' +
    'To book it, join or register with a school or group for this event, or contact Stellr and we’ll help arrange it.'
  )
}

export interface PlanInput {
  actor: BookingActor
  registration: PlanRegistration
  participants: PlanParticipant[]
  addons: PlanAddon[]
  live: LiveLine[]
  request: BookingRequest
  eventDate: string | null
  now?: Date
}

export function planBooking(input: PlanInput): { lines: PlannedLine[]; refusals: Refusal[] } {
  const { actor, registration, participants, addons, live, request, eventDate } = input
  const now = input.now ?? new Date()
  const refusals: Refusal[] = []
  const lines: PlannedLine[] = []
  const refuse = (r: Refusal) => refusals.push(r)

  if (registration.status === 'withdrawn') {
    refuse({ code: 'registration_withdrawn', message: 'This registration has been withdrawn, so extras can’t be added to it.' })
    return { lines, refusals }
  }
  if (!request.items?.length) {
    refuse({ code: 'nothing_chosen', message: 'Choose at least one extra and who it’s for.' })
    return { lines, refusals }
  }

  // Who may pay how (US-13, Q5, Q19).
  const isStaff = actor.kind === 'staff'
  const isGroup = registration.type === 'group'
  const payer = request.payer
  let groupMethod: GroupMethod | null = null
  if (payer === 'included' || payer === 'offline') {
    if (!isStaff) refuse({ code: 'payer_staff_only', message: 'Only Stellr staff can waive an extra or mark it paid.' })
  } else if (payer === 'group') {
    if (!isGroup) refuse({ code: 'payer_not_group', message: 'Only a group registration can have its organizer pay for extras.' })
    if (actor.kind === 'member') refuse({ code: 'payer_not_organiser', message: 'Only your group’s organizer can choose for the group to pay.' })
    groupMethod = request.groupMethod === 'invoice' ? 'invoice' : 'card'
    if (groupMethod === 'invoice' && actor.kind === 'organiser' && actor.role === 'student_manager') {
      refuse({
        code: 'invoice_needs_teacher',
        message: 'Extras can only go on your school’s invoice with your teacher’s agreement. Ask your teacher to add them, or choose card or “each person pays”.',
      })
    }
  } else if (payer !== 'self') {
    refuse({ code: 'payer_unknown', message: 'Choose who pays for these extras.' })
  }
  if (refusals.length) return { lines, refusals }

  const byId = new Map(participants.map((p) => [p.id, p]))
  const addonById = new Map(addons.map((a) => [a.id, a]))
  const taken = new Set(live.map((l) => `${l.participant_id}|${l.addon_id}|${l.variant_id ?? ''}`))
  const seen = new Set<string>()

  for (const item of request.items) {
    const addon = addonById.get(item.addonId)
    if (!addon || addon.event_slug !== registration.event_slug) {
      refuse({ code: 'addon_not_found', message: 'That extra isn’t offered for this event.', addonId: item.addonId })
      continue
    }
    const bookable = isStaff ? addon.status === 'on_sale' || addon.status === 'closed' : onSale(addon, now)
    if (!bookable) {
      refuse({ code: 'addon_not_on_sale', message: `${addon.title} isn’t on sale right now.`, addonId: addon.id })
      continue
    }
    // Group members choose only their own merch; organisers choose the rest (Q15, US-17a).
    if (actor.kind === 'member' && isGroup && addon.kind !== 'merch') {
      refuse({
        code: 'organiser_chooses',
        message: `Your group’s organizer chooses ${addon.title} for the group. Ask them if you’d like it.`,
        addonId: addon.id,
      })
      continue
    }

    let variant: AddonVariant | null = null
    if (addon.kind === 'merch') {
      variant = addon.variants.find((v) => v.variantId === item.variantId) ?? null
      if (!variant) {
        refuse({ code: 'variant_required', message: `Choose a size for ${addon.title}.`, addonId: addon.id })
        continue
      }
    }
    const max = isStaff ? 100 : addon.max_per_person
    const quantity = addon.kind === 'merch' ? Math.floor(Number(item.quantity ?? 1)) : 1
    if (!(quantity >= 1 && quantity <= max)) {
      refuse({ code: 'quantity', message: `You can order between 1 and ${max} of ${addon.title} at a time.`, addonId: addon.id })
      continue
    }

    for (const pid of [...new Set(item.participantIds ?? [])]) {
      const p = byId.get(pid)
      // Only someone attending the event, on this registration (Q3).
      if (!p) {
        refuse({ code: 'participant_not_found', message: 'Extras can only be booked for people on this registration.', addonId: addon.id, participantId: pid })
        continue
      }
      if (actor.kind === 'member' && actor.participantId !== pid) {
        refuse({ code: 'not_yours', message: 'You can only book extras for yourself.', addonId: addon.id, participantId: pid })
        continue
      }
      const adult = isAdultRole(p.event_role)
      if (addon.audience === 'students' && adult) {
        refuse({ code: 'audience', message: `${addon.title} is for students only, so it can’t be booked for ${p.first_name}.`, addonId: addon.id, participantId: pid })
        continue
      }
      if (addon.audience === 'adults' && !adult) {
        refuse({ code: 'audience', message: `${addon.title} is for adults only, so it can’t be booked for ${p.first_name}.`, addonId: addon.id, participantId: pid })
        continue
      }
      const minor = isRegistrationMinor(p.date_of_birth, eventDate)
      const override = isStaff && !!request.overrideMinorRule
      if (addon.minors_group_only && minor && registration.type !== 'group' && !override) {
        refuse({ code: MINOR_INDIVIDUAL_ACCOMMODATION, message: minorIndividualMessage(addon.title), addonId: addon.id, participantId: pid })
        continue
      }
      const key = `${pid}|${addon.id}|${variant?.variantId ?? ''}`
      if (taken.has(key) || seen.has(key)) {
        refuse({ code: 'already_booked', message: `${p.first_name} already has ${addon.title}${variant ? ` (${variant.label})` : ''}.`, addonId: addon.id, participantId: pid })
        continue
      }
      seen.add(key)

      const unit = addon.kind === 'merch' ? (variant?.unitCents ?? 0) : (addon.price_cents ?? 0)
      const needsAddendum = addon.requires_addendum && minor
      const settled = payer === 'included' || payer === 'offline' || unit === 0
      const status: LineStatus = settled ? (needsAddendum ? 'pending_consent' : 'confirmed') : 'pending_payment'
      lines.push({
        addonId: addon.id,
        participantId: pid,
        variantId: variant?.variantId ?? null,
        quantity,
        unitPriceCents: payer === 'included' ? 0 : unit,
        currency: addon.currency,
        payer,
        groupMethod: payer === 'group' ? groupMethod : null,
        status,
        minorRuleOverride: override && addon.minors_group_only && minor && registration.type !== 'group',
        needsAddendum,
      })
    }
  }
  return { lines, refusals }
}

/** Sum of a set of lines, in minor units. */
export function linesTotal(lines: Pick<PlannedLine, 'unitPriceCents' | 'quantity'>[]): number {
  return lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0)
}
