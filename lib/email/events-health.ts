import type { SupabaseClient } from '@supabase/supabase-js'

// Bounce and complaint rates per stream over the last 7 days, from
// email_events (email plan, Workstream C), for the admin dashboard's mail
// health panel. Counts only: never an address.
//
// The thresholds are the ones mailbox providers and Resend act on, and the
// ones Workstream E's kill switch will use: a 7-day complaint rate of 0.1% or
// more, or a bounce rate of 4% or more, over at least 200 sends.

export const RATE_WINDOW_DAYS = 7
export const BOUNCE_RATE_ALERT = 0.04
export const COMPLAINT_RATE_ALERT = 0.001
/** Below this many sends a rate is too noisy to flag. */
export const RATE_MIN_SENDS = 200

/** Streams shown, in order. null = mail sent before streams were tagged, or untagged. */
export const STREAMS: readonly { key: string | null; label: string }[] = [
  { key: 'transactional', label: 'Transactional' },
  { key: 'community', label: 'Community' },
  { key: null, label: 'Untagged' },
]

export interface StreamRates {
  stream: string | null
  label: string
  /** Messages the provider accepted: sent events, or delivered ones when the sent events are not subscribed. */
  sent: number
  bounced: number
  complained: number
  /** null when nothing was sent. */
  bounceRate: number | null
  complaintRate: number | null
  /** True when a rate is at or over its threshold with enough sends to mean it. */
  alert: boolean
}

export function ratesFor(stream: string | null, label: string, counts: { sent: number; delivered: number; bounced: number; complained: number }): StreamRates {
  const sent = Math.max(counts.sent, counts.delivered)
  const bounceRate = sent ? counts.bounced / sent : null
  const complaintRate = sent ? counts.complained / sent : null
  return {
    stream, label, sent, bounced: counts.bounced, complained: counts.complained, bounceRate, complaintRate,
    alert: sent >= RATE_MIN_SENDS && ((bounceRate ?? 0) >= BOUNCE_RATE_ALERT || (complaintRate ?? 0) >= COMPLAINT_RATE_ALERT),
  }
}

/** Every stream's 7-day rates, streams with no mail left out. Throws on a failed count. */
export async function loadStreamRates(db: SupabaseClient, now: Date): Promise<StreamRates[]> {
  const since = new Date(now.getTime() - RATE_WINDOW_DAYS * 86_400_000).toISOString()
  const count = async (stream: string | null, type: string) => {
    const q = db.from('email_events').select('id', { count: 'exact', head: true }).eq('type', type).gte('occurred_at', since)
    const { count: n, error } = await (stream === null ? q.is('stream', null) : q.eq('stream', stream))
    if (error) throw new Error(`Counting email events failed: ${error.message}`)
    return n ?? 0
  }
  const out = await Promise.all(STREAMS.map(async ({ key, label }) => {
    const [sent, delivered, bounced, complained] = await Promise.all(
      ['sent', 'delivered', 'bounced', 'complained'].map((t) => count(key, t)),
    )
    return ratesFor(key, label, { sent, delivered, bounced, complained })
  }))
  return out.filter((r) => r.sent > 0 || r.bounced > 0 || r.complained > 0)
}
