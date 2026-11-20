import { describe, expect, it } from 'vitest'
import { linesTotal, MINOR_INDIVIDUAL_ACCOMMODATION, planBooking, type PlanAddon, type PlanInput } from './plan'
import { checkoutLineItems } from './checkout'
import { settledStatus } from './consent'

const EVENT = 'texas-space-design-competition'
const base: Omit<PlanAddon, 'id' | 'kind' | 'title'> = {
  event_slug: EVENT, description: '', includes: [], service_date: '2027-03-05', service_end_date: null, price_cents: 9500, currency: 'usd',
  capacity: 40, sale_opens_at: null, sale_closes_at: '2027-02-15T00:00:00Z', audience: 'all', refund_rule: 'until_cutoff', refund_until: null,
  requires_addendum: true, minors_group_only: true, max_per_person: 1, store_product_id: null, variant_ids: [], display_group: null, sort: 0,
  status: 'on_sale', variants: [],
}
const night: PlanAddon = { ...base, id: 'night', kind: 'accommodation', title: 'Friday night' }
const tour: PlanAddon = { ...base, id: 'tour', kind: 'experience', title: 'SpaceX tour', price_cents: 2000, minors_group_only: false }
const hoodie: PlanAddon = {
  ...base, id: 'hoodie', kind: 'merch', title: 'Event hoodie', price_cents: null, capacity: null, requires_addendum: false, minors_group_only: false,
  max_per_person: 10, store_product_id: 'p', variant_ids: ['m', 'l'],
  variants: [{ variantId: 'm', label: 'M', sku: 'H-M', unitCents: 3800 }, { variantId: 'l', label: 'L', sku: 'H-L', unitCents: 3800 }],
}
const teacher = { id: 't', first_name: 'Ava', event_role: 'teacher', date_of_birth: '1985-01-01' }
const student = { id: 's', first_name: 'Ben', event_role: 'participant', date_of_birth: '2011-05-01' }
const adultStudent = { id: 'a', first_name: 'Cal', event_role: 'participant', date_of_birth: '2007-01-01' }
const now = new Date('2026-12-01T00:00:00Z')

const groupInput = (over: Partial<PlanInput> = {}): PlanInput => ({
  actor: { kind: 'organiser', role: 'teacher' },
  registration: { id: 'r', type: 'group', status: 'confirmed', event_slug: EVENT },
  participants: [teacher, student, adultStudent],
  addons: [night, tour, hoodie],
  live: [],
  request: { items: [{ addonId: 'night', participantIds: ['t', 's'] }], payer: 'group', groupMethod: 'card' },
  eventDate: '2027-03-06',
  now,
  ...over,
})

describe('planBooking', () => {
  it('an organiser books a night for the group, paid by card', () => {
    const { lines, refusals } = planBooking(groupInput())
    expect(refusals).toEqual([])
    expect(lines.map((l) => [l.participantId, l.status, l.unitPriceCents, l.groupMethod])).toEqual([
      ['t', 'pending_payment', 9500, 'card'],
      ['s', 'pending_payment', 9500, 'card'],
    ])
    expect(lines.find((l) => l.participantId === 's')?.needsAddendum).toBe(true)
    expect(lines.find((l) => l.participantId === 't')?.needsAddendum).toBe(false)
    expect(linesTotal(lines)).toBe(19000)
  })

  it('a minor on an individual registration is refused group-only accommodation, with the whole message (FR-5a)', () => {
    const { lines, refusals } = planBooking(
      groupInput({
        actor: { kind: 'member', participantId: 's' },
        registration: { id: 'r', type: 'individual', status: 'confirmed', event_slug: EVENT },
        participants: [student],
        request: { items: [{ addonId: 'night', participantIds: ['s'] }], payer: 'self' },
      }),
    )
    expect(lines).toEqual([])
    expect(refusals[0].code).toBe(MINOR_INDIVIDUAL_ACCOMMODATION)
    expect(refusals[0].message).toMatch(/travelling with a school or group/)
    expect(refusals[0].message).toMatch(/responsible adult/)
    expect(refusals[0].message).toMatch(/contact Stellr/)
  })

  it('staff can override the minor rule, and it is recorded on the line', () => {
    const { lines, refusals } = planBooking(
      groupInput({
        actor: { kind: 'staff' },
        registration: { id: 'r', type: 'individual', status: 'confirmed', event_slug: EVENT },
        participants: [student],
        request: { items: [{ addonId: 'night', participantIds: ['s'] }], payer: 'included', overrideMinorRule: true },
      }),
    )
    expect(refusals).toEqual([])
    expect(lines[0]).toMatchObject({ minorRuleOverride: true, unitPriceCents: 0, status: 'pending_consent' })
  })

  it('an adult on an individual registration may book accommodation', () => {
    const { refusals } = planBooking(
      groupInput({
        actor: { kind: 'member', participantId: 'a' },
        registration: { id: 'r', type: 'individual', status: 'confirmed', event_slug: EVENT },
        participants: [adultStudent],
        request: { items: [{ addonId: 'night', participantIds: ['a'] }], payer: 'self' },
      }),
    )
    expect(refusals).toEqual([])
  })

  it('a group member chooses only their own merch; the organiser chooses the rest (Q15)', () => {
    const member = { actor: { kind: 'member' as const, participantId: 's' } }
    const tourTry = planBooking(groupInput({ ...member, request: { items: [{ addonId: 'tour', participantIds: ['s'] }], payer: 'self' } }))
    expect(tourTry.refusals[0].code).toBe('organiser_chooses')
    const forOther = planBooking(groupInput({ ...member, request: { items: [{ addonId: 'hoodie', participantIds: ['t'], variantId: 'm' }], payer: 'self' } }))
    expect(forOther.refusals[0].code).toBe('not_yours')
    const own = planBooking(groupInput({ ...member, request: { items: [{ addonId: 'hoodie', participantIds: ['s'], variantId: 'l', quantity: 2 }], payer: 'self' } }))
    expect(own.refusals).toEqual([])
    expect(own.lines[0]).toMatchObject({ quantity: 2, unitPriceCents: 3800, variantId: 'l', status: 'pending_payment' })
    const groupPays = planBooking(groupInput({ ...member, request: { items: [{ addonId: 'hoodie', participantIds: ['s'], variantId: 'l' }], payer: 'group' } }))
    expect(groupPays.refusals[0].code).toBe('payer_not_organiser')
  })

  it('only someone on the registration, once per add-on', () => {
    expect(planBooking(groupInput({ request: { items: [{ addonId: 'tour', participantIds: ['x'] }], payer: 'self' } })).refusals[0].code).toBe('participant_not_found')
    const dup = planBooking(groupInput({ live: [{ addon_id: 'tour', participant_id: 's', variant_id: null }], request: { items: [{ addonId: 'tour', participantIds: ['s'] }], payer: 'self' } }))
    expect(dup.refusals[0].code).toBe('already_booked')
  })

  it('merch needs a size on sale and a quantity within the cap', () => {
    expect(planBooking(groupInput({ request: { items: [{ addonId: 'hoodie', participantIds: ['s'] }], payer: 'self' } })).refusals[0].code).toBe('variant_required')
    expect(planBooking(groupInput({ request: { items: [{ addonId: 'hoodie', participantIds: ['s'], variantId: 'm', quantity: 11 }], payer: 'self' } })).refusals[0].code).toBe('quantity')
    expect(planBooking(groupInput({ actor: { kind: 'staff' }, request: { items: [{ addonId: 'hoodie', participantIds: ['s'], variantId: 'm', quantity: 11 }], payer: 'self' } })).refusals).toEqual([])
  })

  it('off sale, withdrawn, other events and audiences are refused', () => {
    expect(planBooking(groupInput({ now: new Date('2027-02-16T00:00:00Z') })).refusals[0].code).toBe('addon_not_on_sale')
    expect(planBooking(groupInput({ registration: { id: 'r', type: 'group', status: 'withdrawn', event_slug: EVENT } })).refusals[0].code).toBe('registration_withdrawn')
    expect(planBooking(groupInput({ addons: [{ ...night, event_slug: 'other' }] })).refusals[0].code).toBe('addon_not_found')
    const studentsOnly = { ...tour, audience: 'students' as const }
    expect(planBooking(groupInput({ addons: [studentsOnly], request: { items: [{ addonId: 'tour', participantIds: ['t'] }], payer: 'self' } })).refusals[0].code).toBe('audience')
  })

  it('who may pay how (Q5, Q19)', () => {
    expect(planBooking(groupInput({ request: { items: [{ addonId: 'tour', participantIds: ['s'] }], payer: 'included' } })).refusals[0].code).toBe('payer_staff_only')
    const sm = planBooking(groupInput({ actor: { kind: 'organiser', role: 'student_manager' }, request: { items: [{ addonId: 'tour', participantIds: ['s'] }], payer: 'group', groupMethod: 'invoice' } }))
    expect(sm.refusals[0].code).toBe('invoice_needs_teacher')
    const smCard = planBooking(groupInput({ actor: { kind: 'organiser', role: 'student_manager' }, request: { items: [{ addonId: 'tour', participantIds: ['s'] }], payer: 'group', groupMethod: 'card' } }))
    expect(smCard.refusals).toEqual([])
    const indiv = planBooking(groupInput({ registration: { id: 'r', type: 'individual', status: 'confirmed', event_slug: EVENT } }))
    expect(indiv.refusals[0].code).toBe('payer_not_group')
  })

  it('a free add-on needs no payment; a minor waits for the addendum', () => {
    const free = { ...tour, price_cents: 0 }
    const { lines } = planBooking(groupInput({ addons: [free], request: { items: [{ addonId: 'tour', participantIds: ['t', 's'] }], payer: 'self' } }))
    expect(lines.map((l) => [l.participantId, l.status])).toEqual([['t', 'confirmed'], ['s', 'pending_consent']])
  })
})

describe('settledStatus and checkout lines', () => {
  it('waits for the addendum only when it is needed and unsigned', () => {
    expect(settledStatus(true, false)).toBe('pending_consent')
    expect(settledStatus(true, true)).toBe('confirmed')
    expect(settledStatus(false, false)).toBe('confirmed')
  })
  it('Checkout lines carry no names and sum quantities per add-on, size and price', () => {
    const items = checkoutLineItems([
      { title: 'Friday night', variantLabel: null, unitPriceCents: 9500, quantity: 1 },
      { title: 'Friday night', variantLabel: null, unitPriceCents: 9500, quantity: 1 },
      { title: 'Event hoodie', variantLabel: 'M', unitPriceCents: 3800, quantity: 2 },
    ])
    expect(items).toEqual([
      { name: 'Friday night', unitCents: 9500, quantity: 2 },
      { name: 'Event hoodie (M)', unitCents: 3800, quantity: 2 },
    ])
  })
})
