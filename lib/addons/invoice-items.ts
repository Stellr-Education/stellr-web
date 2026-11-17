// Event add-ons on group invoices: the lines an invoice carries, and settling them
// when it is paid (Phase 3 of docs/PLAN-event-add-ons-2026-11-17.md, US-20).
//
// No import of lib/group-billing.ts here: group-billing reads these to put add-on
// items on every seats or add-ons invoice it drafts, so a revision for a roster
// change never drops them.
//
// Invoice items name the add-on and a count ("Friday night × 8"), never a person
// (Q20): who each line is for stays in the app.

import type { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/app-errors'
import { getEventBySlug } from '@/lib/events/repo'
import { isRegistrationMinor } from '@/lib/registration-eligibility'
import { addendumSignedFor, settledStatus } from './consent'

export interface AddonInvoiceItem {
  description: string
  quantity: number
  unitCents: number
  currency: string
}

export interface InvoiceAddons {
  items: AddonInvoiceItem[]
  lineIds: string[]
  totalCents: number
}

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

/** One invoice item per (add-on, size, price), quantities summed. Pure. */
export function groupAddonItems(
  lines: { title: string; variantLabel: string | null; unitPriceCents: number; quantity: number; currency: string }[],
  eventTitle: string,
): AddonInvoiceItem[] {
  const out = new Map<string, AddonInvoiceItem>()
  for (const l of lines) {
    const what = l.variantLabel ? `${l.title} (${l.variantLabel})` : l.title
    const key = `${what}|${l.unitPriceCents}|${l.currency}`
    const cur = out.get(key)
    if (cur) cur.quantity += l.quantity
    else out.set(key, { description: `${eventTitle} — ${what} (per person)`, quantity: l.quantity, unitCents: l.unitPriceCents, currency: l.currency })
  }
  return [...out.values()]
}

/**
 * The group's add-on lines still owed on an invoice: payer the group, by invoice,
 * not yet paid. Lines already on a paid invoice are excluded by their status.
 */
export async function invoiceAddons(db: SupabaseClient, registrationId: string, eventTitle: string): Promise<InvoiceAddons> {
  const { data, error } = await db
    .from('registration_addons')
    .select('id, quantity, unit_price_cents, currency, variant_id, addon:event_addons(title)')
    .eq('registration_id', registrationId)
    .eq('payer', 'group')
    .eq('group_method', 'invoice')
    .eq('status', 'pending_payment')
  if (error) throw new Error(`invoice add-ons: ${error.message}`)
  const rows = (data ?? []) as { id: string; quantity: number; unit_price_cents: number; currency: string; variant_id: string | null; addon: unknown }[]
  const free = rows.filter((r) => r.unit_price_cents === 0)
  const priced = rows.filter((r) => r.unit_price_cents > 0)
  if (free.length) {
    // Nothing to invoice for a free line: it is settled as booked.
    await db.from('registration_addons').update({ status: 'confirmed' }).in('id', free.map((r) => r.id)).eq('status', 'pending_payment')
  }
  const variantIds = [...new Set(priced.map((r) => r.variant_id).filter((v): v is string => !!v))]
  const labels = new Map<string, string>()
  if (variantIds.length) {
    const { data: vs } = await db.from('store_variants').select('id, label').in('id', variantIds)
    for (const v of (vs ?? []) as { id: string; label: string | null }[]) labels.set(v.id, v.label ?? '')
  }
  const items = groupAddonItems(
    priced.map((r) => ({
      title: (arr(r.addon) as { title?: string } | undefined)?.title ?? 'Extra',
      variantLabel: r.variant_id ? labels.get(r.variant_id) || null : null,
      unitPriceCents: r.unit_price_cents,
      quantity: r.quantity,
      currency: r.currency,
    })),
    eventTitle,
  )
  return {
    items,
    lineIds: priced.map((r) => r.id),
    totalCents: priced.reduce((n, r) => n + r.unit_price_cents * r.quantity, 0),
  }
}

/** Point the lines at the invoice now carrying them. */
export async function linkLinesToInvoice(db: SupabaseClient, lineIds: string[], groupInvoiceRowId: string | null) {
  if (lineIds.length === 0 || !groupInvoiceRowId) return
  await db.from('registration_addons').update({ group_invoice_id: groupInvoiceRowId }).in('id', lineIds).eq('status', 'pending_payment')
}

/** The invoice carrying these lines was paid: confirm them (or await the addendum, for a minor). */
export async function settleInvoiceAddonLines(db: SupabaseClient, groupInvoiceRowId: string, paidAt: string): Promise<number> {
  const { data } = await db
    .from('registration_addons')
    .select('id, participant_id, addon:event_addons(event_slug, requires_addendum), participant:participants(date_of_birth)')
    .eq('group_invoice_id', groupInvoiceRowId)
    .eq('status', 'pending_payment')
  const lines = (data ?? []) as { id: string; participant_id: string; addon: unknown; participant: unknown }[]
  if (lines.length === 0) return 0
  try {
    const slug = (arr(lines[0].addon) as { event_slug?: string } | undefined)?.event_slug
    const event = slug ? await getEventBySlug(slug).catch(() => null) : null
    const eventDate = (event as { date?: string } | null)?.date ?? null
    const signed = await addendumSignedFor(db, [...new Set(lines.map((l) => l.participant_id))])
    for (const l of lines) {
      const addon = arr(l.addon) as { requires_addendum?: boolean } | undefined
      const dob = (arr(l.participant) as { date_of_birth?: string | null } | undefined)?.date_of_birth ?? null
      const status = settledStatus(!!addon?.requires_addendum && isRegistrationMinor(dob, eventDate), signed.has(l.participant_id))
      await db.from('registration_addons').update({ status, paid_at: paidAt }).eq('id', l.id).eq('status', 'pending_payment')
    }
  } catch (e) {
    await reportError(e, { route: 'LIB addons/invoice-items settle', db })
  }
  return lines.length
}
