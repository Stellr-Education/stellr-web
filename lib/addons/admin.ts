// Event add-ons: what staff see and do (Phase 5 of docs/PLAN-event-add-ons-2026-11-17.md,
// US-4, US-6, US-7, US-23). Every read is for one event; exports carry the minimum each
// add-on's provider needs (FR-17): name, age at the event, group, and the group's lead.
// Never health, dietary or contact details of a student.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ageOn, onDate } from '@/lib/age'
import { isAdultRole } from '@/lib/group-payer'
import { toCsv } from '@/lib/csv'
import { LINE_STATUS_LABEL, PAYER_LABEL } from './labels'

const arr = <T>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined))

export interface StaffLine {
  id: string
  addonId: string
  addonTitle: string
  addonKind: string
  participantId: string
  firstName: string
  lastName: string
  adult: boolean
  dateOfBirth: string | null
  registrationId: string
  registrationType: string
  group: string | null
  leadName: string | null
  quantity: number
  unitPriceCents: number
  currency: string
  payer: string
  groupMethod: string | null
  status: string
  checkedAt: string | null
  variantId: string | null
}

export async function loadEventBookings(db: SupabaseClient, eventSlug: string): Promise<StaffLine[]> {
  const { data, error } = await db
    .from('registration_addons')
    .select(
      'id, addon_id, participant_id, registration_id, quantity, unit_price_cents, currency, payer, group_method, status, checked_at, variant_id, ' +
        'addon:event_addons!inner(title, kind, event_slug), ' +
        'participant:participants(first_name, last_name, event_role, date_of_birth), ' +
        'registration:registrations(type, school_name, group_name, teacher_first_name, teacher_last_name)',
    )
    .eq('addon.event_slug', eventSlug)
    .order('created_at')
  if (error) throw new Error(`event bookings: ${error.message}`)
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const a = arr(r.addon as unknown) as { title: string; kind: string } | undefined
    const p = arr(r.participant as unknown) as { first_name: string; last_name: string; event_role: string | null; date_of_birth: string | null } | undefined
    const g = arr(r.registration as unknown) as { type: string; school_name: string | null; group_name: string | null; teacher_first_name: string | null; teacher_last_name: string | null } | undefined
    return {
      id: r.id as string,
      addonId: r.addon_id as string,
      addonTitle: a?.title ?? 'Extra',
      addonKind: a?.kind ?? 'experience',
      participantId: r.participant_id as string,
      firstName: p?.first_name ?? '',
      lastName: p?.last_name ?? '',
      adult: isAdultRole(p?.event_role),
      dateOfBirth: p?.date_of_birth ?? null,
      registrationId: r.registration_id as string,
      registrationType: g?.type ?? 'individual',
      group: g?.group_name || g?.school_name || null,
      leadName: g?.type === 'group' ? [g?.teacher_first_name, g?.teacher_last_name].filter(Boolean).join(' ') || null : null,
      quantity: r.quantity as number,
      unitPriceCents: r.unit_price_cents as number,
      currency: r.currency as string,
      payer: r.payer as string,
      groupMethod: (r.group_method as string | null) ?? null,
      status: r.status as string,
      checkedAt: (r.checked_at as string | null) ?? null,
      variantId: (r.variant_id as string | null) ?? null,
    }
  })
}

/** One add-on's manifest (US-7): live lines only, the fields its provider needs. Pure. */
export function manifestCsv(lines: StaffLine[], eventDate: string | null): string {
  const live = lines.filter((l) => ['confirmed', 'pending_consent', 'pending_payment'].includes(l.status))
  const header = ['First name', 'Last name', 'Adult or student', 'Age at the event', 'Group', 'Group lead', 'Quantity', 'Status']
  const rows = live
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.lastName.localeCompare(b.lastName))
    .map((l) => [
      l.firstName,
      l.lastName,
      l.adult ? 'Adult' : 'Student',
      l.dateOfBirth && eventDate ? String(ageOn(l.dateOfBirth, onDate(eventDate))) : '',
      l.group ?? (l.registrationType === 'individual' ? 'Individual' : ''),
      l.leadName ?? '',
      l.quantity,
      LINE_STATUS_LABEL[l.status] ?? l.status,
    ])
  return toCsv([header, ...rows])
}

/** For the staff table: counts per add-on and a plain-words payer. Pure. */
export function payerWords(l: Pick<StaffLine, 'payer' | 'groupMethod'>): string {
  if (l.payer === 'group') return l.groupMethod === 'invoice' ? 'Group invoice' : 'Group card'
  return PAYER_LABEL[l.payer] ?? l.payer
}

/** Each participant's live, non-merch extras, for the roster export and the check-in desk. */
export async function extrasByParticipant(db: SupabaseClient, eventSlug: string): Promise<Map<string, { lineId: string; title: string; status: string; checkedAt: string | null }[]>> {
  const out = new Map<string, { lineId: string; title: string; status: string; checkedAt: string | null }[]>()
  const { data, error } = await db
    .from('registration_addons')
    .select('id, participant_id, status, checked_at, addon:event_addons!inner(title, kind, event_slug)')
    .eq('addon.event_slug', eventSlug)
    .in('status', ['confirmed', 'pending_consent', 'pending_payment'])
  if (error) return out
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const a = arr(r.addon as unknown) as { title: string; kind: string } | undefined
    if (!a || a.kind === 'merch') continue
    const pid = r.participant_id as string
    out.set(pid, [...(out.get(pid) ?? []), { lineId: r.id as string, title: a.title, status: r.status as string, checkedAt: (r.checked_at as string | null) ?? null }])
  }
  return out
}

// ── Writes and reads for the staff bookings route (kept here: admin routes query no tenant table directly) ──

/** The ids, of those given, that are lines of this event's add-ons. */
export async function lineIdsOfEvent(db: SupabaseClient, eventSlug: string, ids: string[]): Promise<string[]> {
  const { data } = await db.from('registration_addons').select('id, addon:event_addons!inner(event_slug)').in('id', ids).eq('addon.event_slug', eventSlug)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/** Every registration with an add-on line on this event (cancelling everything). */
export async function registrationsWithAddons(db: SupabaseClient, eventSlug: string): Promise<string[]> {
  const { data } = await db.from('registration_addons').select('registration_id, addon:event_addons!inner(event_slug)').eq('addon.event_slug', eventSlug)
  return [...new Set(((data ?? []) as { registration_id: string }[]).map((r) => r.registration_id))]
}

/** Tick a line off at the desk, or undo it. */
export async function setLinesChecked(db: SupabaseClient, ids: string[], checked: boolean) {
  await db.from('registration_addons').update({ checked_at: checked ? new Date().toISOString() : null }).in('id', ids)
}

/** The unpaid lines among these, with how they were to be paid. */
export async function unpaidLines(db: SupabaseClient, ids: string[]) {
  const { data } = await db.from('registration_addons').select('id, order_id, registration_id, payer, group_method').in('id', ids).eq('status', 'pending_payment')
  return (data ?? []) as { id: string; order_id: string | null; registration_id: string; payer: string; group_method: string | null }[]
}

/** An order whose lines left it: its total follows, and an empty one closes. */
export async function refreshOrder(db: SupabaseClient, orderId: string) {
  const { data } = await db.from('registration_addons').select('quantity, unit_price_cents').eq('order_id', orderId).eq('status', 'pending_payment')
  const lines = (data ?? []) as { quantity: number; unit_price_cents: number }[]
  if (lines.length === 0) await db.from('addon_orders').update({ status: 'cancelled', stripe_checkout_session_id: null }).eq('id', orderId).eq('status', 'open')
  else await db.from('addon_orders').update({ total_cents: lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0), stripe_checkout_session_id: null }).eq('id', orderId).eq('status', 'open')
}
