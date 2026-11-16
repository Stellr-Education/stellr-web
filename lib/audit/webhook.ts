// Auditing a provider's webhook (S5 A13a, docs/PLAN-S5-wave8-DRAFT.md, row 2).
//
// One event per delivery, 'webhook.event.process', by the `webhook:<provider>` actor
// C7 added. The route wraps its handler in withAudit, which records every answer
// but a 4xx, and the handler notes what it verified (noteWebhook) as it goes:
//
//   export const POST = withAudit(
//     ({ args: [req] }: { args: [Request] }) => ({ action: 'webhook.event.process', ...webhookEvent('stripe', req) }),
//     handle,
//   )
//
// A delivery the handler never verified, which only a missing secret lets through
// with a 5xx, is recorded with verified: false.
//
// The tenant comes from the stored row an event names, never from the payload alone:
// the payload gives the key, the row gives the tenant (ownerChain, below). Which chain
// a tenant's payment or webhook event goes on is the owner's call (BF-4). Until then
// it goes on Stellr's chain, as B16's member payment rows do, with the owning tenant
// in the metadata, so the rows can be told apart if the decision moves them.
//
// Nothing here reads the database while PLATFORM_AUDIT_ENABLED is off: a note is an
// in-memory entry keyed by the request, and ownerChain runs only when an event is
// written.
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { AuditMutation } from './route'

/** The stored row whose tenant owns a provider's event. */
export type OwnerRef =
  /** An event registration, by its id. */
  | { registrationId: string }
  /** An agreement (an e-signature envelope), by its row id. */
  | { agreementId: string }
  /**
   * A Stripe payment intent: the registration, seat or group invoice it paid for. One
   * that pays for none of them paid for something only Stellr sells (store, membership,
   * bookings), so it is Stellr's.
   */
  | { paymentIntent: string }
  /** The tenant_id the handler already read from the stored row. */
  | { rowTenantId: string | null }

export interface WebhookNote {
  owner?: OwnerRef
  target?: AuditMutation['target']
  metadata?: Record<string, unknown>
}

const notes = new WeakMap<object, WebhookNote>()

/** What the handler has verified about this delivery. Later notes add to earlier ones. */
export function noteWebhook(req: object, note: WebhookNote = {}): void {
  const was = notes.get(req)
  notes.set(req, { ...was, ...note, metadata: { ...was?.metadata, ...note.metadata } })
}

/** The event for one delivery, all but its action, which the route names as a literal. */
export function webhookEvent(provider: string, req: object): Omit<AuditMutation, 'action'> {
  const note = notes.get(req)
  return {
    actor: { webhook: provider },
    tenant: note?.owner ? { owner: note.owner } : { stellr: true },
    target: note?.target,
    metadata: { ...note?.metadata, verified: note !== undefined },
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAYMENT_INTENT = /^pi_[A-Za-z0-9_]{1,128}$/

type Found = { found: true; tenantId: string | null } | { found: false }

async function tenantOf(db: SupabaseClient, table: string, column: string, value: string): Promise<Found> {
  const { data, error } = await db.from(table).select('tenant_id').eq(column, value).limit(1).maybeSingle()
  if (error) throw new Error(`${table} read failed`)
  return data ? { found: true, tenantId: (data as { tenant_id: string | null }).tenant_id } : { found: false }
}

async function ownerRow(ref: OwnerRef, db: SupabaseClient): Promise<Found | 'stellr_product'> {
  if ('rowTenantId' in ref) return { found: true, tenantId: ref.rowTenantId }
  if ('registrationId' in ref) return UUID.test(ref.registrationId) ? tenantOf(db, 'registrations', 'id', ref.registrationId) : { found: false }
  if ('agreementId' in ref) return UUID.test(ref.agreementId) ? tenantOf(db, 'agreements', 'id', ref.agreementId) : { found: false }
  if (!PAYMENT_INTENT.test(ref.paymentIntent)) return { found: false }
  for (const [table, column] of [
    ['registrations', 'stripe_payment_intent_id'],
    ['participants', 'stripe_payment_intent_id'],
    ['group_invoices', 'payment_intent_id'],
  ] as const) {
    const row = await tenantOf(db, table, column, ref.paymentIntent)
    if (row.found) return row
  }
  return 'stellr_product'
}

/**
 * The chain for an event its stored row owns, and what the row should say. A row that
 * is not there, has no tenant, or cannot be read is unresolved (the platform chain,
 * marked), never a guess: the table is append-only. BF-4's default puts a tenant's
 * event on Stellr's chain with owner_tenant_id saying whose it is.
 */
export async function ownerChain(ref: OwnerRef, db: SupabaseClient): Promise<{ tenantId: string | null; metadata: Record<string, unknown> }> {
  const row = await ownerRow(ref, db)
  if (row === 'stellr_product') return { tenantId: STELLR_TENANT_ID, metadata: {} }
  if (!row.found || !row.tenantId) return { tenantId: null, metadata: { tenant_unresolved: true } }
  if (row.tenantId === STELLR_TENANT_ID) return { tenantId: STELLR_TENANT_ID, metadata: {} }
  return { tenantId: STELLR_TENANT_ID, metadata: { owner_tenant_id: row.tenantId } }
}

/** Checkout session types for what only Stellr sells (app/api/stripe/webhook, fulfilCheckoutSession). */
const STELLR_CHECKOUT_TYPES = new Set([
  'membership',
  'mentoring_topup',
  'coaching_topup',
  'coaching_request_pay',
  'entitlement_booking',
  'workshop_enrollment',
  'workshop_topup',
  'store_order',
])

/** The stored row a Stripe event's work lands on, or null for Stellr's own products. */
export function stripeEventOwner(event: Stripe.Event): OwnerRef | null {
  if (event.type.startsWith('checkout.session.')) {
    const session = event.data.object as Stripe.Checkout.Session
    if (STELLR_CHECKOUT_TYPES.has(session.metadata?.type ?? '')) return null
    const registrationId = session.metadata?.registrationId ?? session.client_reference_id
    return registrationId ? { registrationId } : null
  }
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice
    if (invoice.metadata?.type?.startsWith('membership')) return null
    const registrationId = invoice.metadata?.registrationId
    return registrationId ? { registrationId } : null
  }
  if (event.type === 'charge.refunded') {
    const pi = (event.data.object as Stripe.Charge).payment_intent
    const paymentIntent = typeof pi === 'string' ? pi : pi?.id
    return paymentIntent ? { paymentIntent } : null
  }
  return null
}

/** The note for a verified Stripe event. */
export function stripeEventNote(event: Stripe.Event): WebhookNote {
  const owner = stripeEventOwner(event)
  return {
    ...(owner ? { owner } : {}),
    target: { table: 'stripe_webhook_events', id: event.id },
    metadata: { event_type: event.type },
  }
}
