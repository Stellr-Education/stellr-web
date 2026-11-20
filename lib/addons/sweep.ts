// Event add-ons: the daily sweep for unpaid places (Q17b; Phase 4 of
// docs/PLAN-event-add-ons-2026-11-17.md). Runs inside the group-invoice-sync cron
// (no new cron, Hobby limits).
//
//   - an unpaid line is kept until its add-on's sales cut-off, then released
//     (status 'expired'), its order shrinks and an invoice it was on is revised;
//   - 7 days before the cut-off, each open pay link's payer gets one reminder.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/app-errors'
import { sendEmail } from '@/lib/email'
import { addonPayPageUrl, loadOrderLines } from './booking'
import { cancelAddonLines } from './cancel'
import { addonReminderEmail } from './emails'
import { resyncAddonInvoice } from './invoice'

const DAY = 86_400_000

export async function sweepUnpaidAddons(db: SupabaseClient, stripe: Stripe | null, now: Date = new Date()): Promise<{ released: number; reminded: number }> {
  let released = 0
  let reminded = 0

  // 1. Release unpaid lines past their cut-off.
  const { data: due, error } = await db
    .from('registration_addons')
    .select('id, addon:event_addons!inner(sale_closes_at)')
    .eq('status', 'pending_payment')
    .lt('addon.sale_closes_at', now.toISOString())
    .limit(500)
  if (error) throw new Error(`add-on release read: ${error.message}`)
  const ids = ((due ?? []) as { id: string }[]).map((r) => r.id)
  if (ids.length) {
    const out = await cancelAddonLines(db, stripe, ids, {
      reason: 'released',
      actorMemberId: null,
      onInvoiceChanged: (regId) => resyncAddonInvoice(db, regId),
    })
    released = out.length
  }

  // 2. Remind each open pay link's payer once, in the week before its earliest cut-off.
  const { data: orders } = await db
    .from('addon_orders')
    .select('id, event_slug, registration_id, payer_kind, payer_participant_id, total_cents, currency, pay_token')
    .eq('status', 'open')
    .is('reminder_sent_at', null)
    .limit(500)
  for (const o of (orders ?? []) as { id: string; event_slug: string; registration_id: string | null; payer_kind: string; payer_participant_id: string | null; total_cents: number; currency: string; pay_token: string | null }[]) {
    try {
      const lines = (await loadOrderLines(db, o.id)).filter((l) => l.status === 'pending_payment')
      const closes = lines.map((l) => l.saleClosesAt).filter((d): d is string => !!d).sort()[0]
      if (!closes || !o.pay_token) continue
      const left = new Date(closes).getTime() - now.getTime()
      if (left <= 0 || left > 7 * DAY) continue
      const recipient = await payerOf(db, o)
      if (!recipient) continue
      const { data: reg } = o.registration_id ? await db.from('registrations').select('event_title').eq('id', o.registration_id).maybeSingle() : { data: null }
      const msg = addonReminderEmail({
        firstName: recipient.firstName,
        eventTitle: (reg as { event_title?: string } | null)?.event_title ?? 'your event',
        lines: lines.map((l) => ({ title: l.title, firstName: l.firstName, quantity: l.quantity, unitPriceCents: l.unitPriceCents, currency: l.currency })),
        totalCents: lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0),
        currency: o.currency,
        payUrl: addonPayPageUrl(o.event_slug, o.pay_token),
        closesAt: closes,
      })
      await sendEmail({ to: recipient.email, subject: msg.subject, html: msg.html, text: msg.text })
      await db.from('addon_orders').update({ reminder_sent_at: now.toISOString() }).eq('id', o.id)
      reminded++
    } catch (e) {
      await reportError(e, { route: 'LIB addons/sweep reminder', db })
    }
  }
  return { released, reminded }
}

async function payerOf(
  db: SupabaseClient,
  o: { payer_kind: string; payer_participant_id: string | null; registration_id: string | null },
): Promise<{ email: string; firstName: string } | null> {
  if (o.payer_kind === 'self' && o.payer_participant_id) {
    const { data } = await db.from('participants').select('email, first_name').eq('id', o.payer_participant_id).maybeSingle()
    const p = data as { email: string | null; first_name: string } | null
    return p?.email ? { email: p.email, firstName: p.first_name } : null
  }
  if (o.registration_id) {
    const { data } = await db.from('registrations').select('teacher_email, teacher_first_name').eq('id', o.registration_id).maybeSingle()
    const r = data as { teacher_email: string | null; teacher_first_name: string | null } | null
    return r?.teacher_email ? { email: r.teacher_email, firstName: r.teacher_first_name ?? 'there' } : null
  }
  return null
}
