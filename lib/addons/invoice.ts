// Event add-ons on group invoices: putting the group's invoiced add-ons onto the
// right invoice (Phase 3 of docs/PLAN-event-add-ons-2026-11-17.md, US-20, Q5).
//
//   - the group's main invoice is unpaid      -> revise it (places + add-ons)
//   - else an add-ons invoice is unpaid       -> revise that one
//   - else there are add-ons owed             -> issue a new add-ons-only invoice
//   - an unpaid add-ons invoice with nothing left on it is voided
//
// The same withInvoiceLock as roster changes, so a roster revision and an add-on
// revision never race (lib/group-billing.ts). A group whose places aren't invoiced
// (card or individual) gets add-ons-only invoices (Q5).

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createGroupInvoice,
  currentSeatsInvoice,
  invoiceCustomer,
  ledgerFor,
  loadRegistration,
  reviseGroupInvoice,
  voidGroupInvoice,
  withInvoiceLock,
  type Actor,
} from '@/lib/group-billing'
import { invoiceAddons } from './invoice-items'
import { markInvoiceSyncDue } from '@/lib/group-billing'
import { stripeClient } from '@/lib/stripe'

export type AddonInvoiceSync = 'none' | 'revised_main' | 'revised_addons' | 'created' | 'voided' | 'busy'

export async function syncAddonInvoice(db: SupabaseClient, stripe: Stripe, registrationId: string, actor: Actor): Promise<AddonInvoiceSync> {
  const result = await withInvoiceLock(db, registrationId, async (): Promise<AddonInvoiceSync> => {
    const reg = await loadRegistration(db, registrationId)
    if (!reg || reg.status === 'withdrawn') return 'none'
    const addons = await invoiceAddons(db, reg.id, reg.event_title)
    const currency = addons.items[0]?.currency ?? 'usd'

    // 1. The main invoice, while unpaid, carries the add-ons.
    const main = reg.invoice_requested ? await currentSeatsInvoice(db, stripe, reg) : null
    if (main && main.invoice.status === 'open' && main.row) {
      if (main.row.addons_cents === addons.totalCents && sameLines(main.row.id, addons.lineIds, await linkedLineIds(db, main.row.id))) return 'none'
      await reviseGroupInvoice(db, stripe, main.invoice, {
        reg, seats: main.row.seats, perSeatCents: main.row.per_seat_cents, currency: main.invoice.currency ?? currency, actor,
        customerId: await invoiceCustomer(db, stripe, reg, main.invoice),
        reason: addons.totalCents > 0 ? 'Updated with the group’s extras' : 'Extras removed',
        couponId: reg.invoice_coupon_id, kind: 'seats', addons,
      })
      return 'revised_main'
    }

    // 2. Otherwise an unpaid add-ons invoice is revised, or voided when nothing is left on it.
    const ledger = await ledgerFor(db, reg.id)
    const openAddons = [...ledger].reverse().find((r) => r.kind === 'addons' && r.status === 'open')
    if (openAddons) {
      const invoice = await stripe.invoices.retrieve(openAddons.stripe_invoice_id)
      if (invoice.status === 'open') {
        if (addons.items.length === 0) {
          await voidGroupInvoice(db, stripe, invoice, 'Cancelled: no extras are left to pay for')
          return 'voided'
        }
        if (openAddons.addons_cents === addons.totalCents && sameLines(openAddons.id, addons.lineIds, await linkedLineIds(db, openAddons.id))) return 'none'
        await reviseGroupInvoice(db, stripe, invoice, {
          reg, seats: 0, perSeatCents: 0, currency, actor,
          customerId: await invoiceCustomer(db, stripe, reg, invoice),
          reason: 'Extras updated', couponId: null, kind: 'addons', addons,
        })
        return 'revised_addons'
      }
    }

    // 3. Nothing unpaid to carry them: a new add-ons-only invoice.
    if (addons.items.length === 0) return 'none'
    await createGroupInvoice(db, stripe, {
      reg, seats: 0, perSeatCents: 0, currency, actor,
      customerId: await invoiceCustomer(db, stripe, reg, main?.invoice ?? null),
      reason: `Extras for ${reg.event_title}`, couponId: null, kind: 'addons', addons,
    })
    return 'created'
  })
  return result ?? 'busy'
}

async function linkedLineIds(db: SupabaseClient, groupInvoiceRowId: string): Promise<string[]> {
  const { data } = await db.from('registration_addons').select('id').eq('group_invoice_id', groupInvoiceRowId).eq('status', 'pending_payment')
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/** The invoice already carries exactly the lines owed. Pure. */
export function sameLines(_rowId: string, owed: string[], linked: string[]): boolean {
  if (owed.length !== linked.length) return false
  const a = new Set(owed)
  return linked.every((id) => a.has(id))
}

/** After add-on lines on a group's invoice change: revise it now, or leave it to the daily sync. Never throws. */
export async function resyncAddonInvoice(db: SupabaseClient, registrationId: string): Promise<void> {
  const stripe = stripeClient()
  if (!stripe) return
  try {
    const r = await syncAddonInvoice(db, stripe, registrationId, { memberId: null, label: 'add-on change' })
    if (r === 'busy') await markInvoiceSyncDue(db, registrationId)
  } catch (e) {
    console.error('[addons/invoice] resync failed; left to the daily sync:', e)
    await markInvoiceSyncDue(db, registrationId)
  }
}
