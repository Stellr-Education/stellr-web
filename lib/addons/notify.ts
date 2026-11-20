// Event add-ons: emailing "each person pays" links (US-18, Q20). Shared by the member
// page and registration, so both send the same email to the same people.

import type { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/app-errors'
import { sendEmail } from '@/lib/email'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { addonPayPageUrl, loadOrderLines, type BookingParticipant } from './booking'
import { addonPayLinkEmail } from './emails'

const GUARDIAN = /parent|guardian|mother|father|mom|dad|mum/i

/** The person's own pay link, to them and, for a minor, to a parent or guardian on file. Returns who was emailed. */
export async function sendAddonPayLinks(
  db: SupabaseClient,
  opts: {
    eventSlug: string
    eventTitle: string
    eventDate: string | null
    bookedBy: string
    participants: BookingParticipant[]
    orders: { id: string; payerKind: 'group' | 'self'; participantId: string | null; totalCents: number; payToken: string | null }[]
    /** Skip this participant's order (they are paying now). */
    exceptParticipantId?: string | null
  },
): Promise<string[]> {
  const sent: string[] = []
  for (const order of opts.orders) {
    if (order.payerKind !== 'self' || !order.payToken || order.participantId === opts.exceptParticipantId) continue
    const person = opts.participants.find((x) => x.id === order.participantId)
    if (!person?.email) continue
    try {
      const lines = await loadOrderLines(db, order.id)
      const msg = addonPayLinkEmail({
        firstName: person.first_name,
        eventTitle: opts.eventTitle,
        lines: lines.map((l) => ({ title: l.title, firstName: l.firstName, quantity: l.quantity, unitPriceCents: l.unitPriceCents, currency: l.currency })),
        totalCents: order.totalCents,
        currency: lines[0]?.currency ?? 'usd',
        payUrl: addonPayPageUrl(opts.eventSlug, order.payToken),
        closesAt: lines.map((l) => l.saleClosesAt).filter((d): d is string => !!d).sort()[0] ?? null,
        bookedBy: opts.bookedBy,
      })
      const guardian =
        isRegistrationMinor(person.date_of_birth, opts.eventDate) && person.emergency_contact_email && GUARDIAN.test(person.emergency_contact_relationship ?? '')
          ? [person.emergency_contact_email]
          : []
      await sendEmail({ to: person.email, cc: guardian.length ? guardian : undefined, subject: msg.subject, html: msg.html, text: msg.text })
      sent.push(person.first_name)
    } catch (e) {
      await reportError(e, { route: 'LIB addons/notify pay link', db })
    }
  }
  return sent
}
