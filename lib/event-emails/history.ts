// Shared send-history helpers, used by both a normal send (send.ts) and the
// late-registrant catch-up (catch-up.ts). Kept in their own module so send.ts
// can read the history without importing catch-up.ts (which imports send.ts),
// i.e. to avoid an import cycle.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedRecipient } from './audiences'

export function missedRecipients(recipients: ResolvedRecipient[], alreadyTried: Set<string>): ResolvedRecipient[] {
  return recipients.filter((r) => !alreadyTried.has(r.email.toLowerCase()))
}

/**
 * Every address a real (non-test) send of this email has already tried — sent,
 * failed, suppressed, or caught mid-send ('sending') — but not 'not_reached'. deep review INT-1: `deliver` records each recipient as it goes, so
 * this reflects progress even when an earlier run was killed mid-send, and a
 * re-run (a resumed stuck send, or the next catch-up) skips those addresses
 * instead of emailing them a second time.
 */
export async function alreadyTriedAddresses(db: SupabaseClient, emailId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('event_email_sends')
    .select('recipients')
    .eq('event_email_id', emailId)
    .neq('trigger', 'test')
  // Never guess on a failed read: an empty set would email everyone again.
  if (error) throw new Error(`Could not read send history: ${error.message}`)
  const out = new Set<string>()
  for (const row of data ?? []) {
    for (const r of (row.recipients as { email?: string; status?: string }[] | null) ?? []) {
      // 'not_reached' = listed by a run that stopped before their turn: still owed.
      // 'sending' = handed to Resend when the run was killed: counted as tried.
      if (r?.email && r.status !== 'not_reached') out.add(r.email.toLowerCase())
    }
  }
  return out
}

/**
 * Did the latest real (non-test) run of this email record itself as finished?
 * A run that stopped at its time limit writes finished_at before it returns,
 * so a continue may take over at once; a run still going (or killed) has none.
 * No run at all (killed before its first recipient) answers false.
 */
export async function latestRunFinished(db: SupabaseClient, emailId: string): Promise<boolean> {
  const { data, error } = await db
    .from('event_email_sends')
    .select('finished_at')
    .eq('event_email_id', emailId)
    .neq('trigger', 'test')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return false
  return data.finished_at != null
}

// ── Delivery status from the email events store (email plan, Workstream C) ──

/** What the mail provider has since said about a message, latest that matters. */
export type DeliveryStatus =
  | 'sent' | 'delivery_delayed' | 'delivered' | 'opened' | 'clicked'
  | 'bounced' | 'complained' | 'suppressed' | 'failed'

export interface DeliveryInfo {
  status: DeliveryStatus
  /** When that event happened (ISO). */
  at: string
}

/**
 * Which event decides a message's status when several arrived. A problem
 * beats any success (a message can be delivered and then complained about);
 * among successes the furthest along wins; a delay only shows until something
 * better arrives.
 */
const DELIVERY_RANK: Record<DeliveryStatus, number> = {
  sent: 0,
  delivery_delayed: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  failed: 5,
  suppressed: 6,
  bounced: 7,
  complained: 8,
}

/** The deciding status from a message's events. Null when there are none. */
export function deliveryFromEvents(events: { type: string; occurred_at: string }[]): DeliveryInfo | null {
  let best: DeliveryInfo | null = null
  for (const e of events) {
    const status = e.type as DeliveryStatus
    if (!(status in DELIVERY_RANK)) continue
    if (!best || DELIVERY_RANK[status] > DELIVERY_RANK[best.status]
      || (status === best.status && e.occurred_at > best.at)) best = { status, at: e.occurred_at }
  }
  return best
}

/** Provider ids are looked up this many at a time (PostgREST URL length). */
const ID_CHUNK = 150

/**
 * Delivery status per Resend id, from email_events. Ids with no events are
 * left out. Throws on a failed read; History catches it and shows the send as
 * recorded.
 */
export async function loadDeliveryStatus(db: SupabaseClient, resendIds: string[]): Promise<Map<string, DeliveryInfo>> {
  const ids = [...new Set(resendIds.filter(Boolean))]
  const byId = new Map<string, { type: string; occurred_at: string }[]>()
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await db
      .from('email_events')
      .select('provider_email_id, type, occurred_at')
      .eq('provider', 'resend')
      .in('provider_email_id', ids.slice(i, i + ID_CHUNK))
    if (error) throw new Error(`Could not read delivery events: ${error.message}`)
    for (const row of (data ?? []) as { provider_email_id: string; type: string; occurred_at: string }[]) {
      const list = byId.get(row.provider_email_id) ?? []
      list.push(row)
      byId.set(row.provider_email_id, list)
    }
  }
  const out = new Map<string, DeliveryInfo>()
  for (const [id, events] of byId) {
    const d = deliveryFromEvents(events)
    if (d) out.set(id, d)
  }
  return out
}
