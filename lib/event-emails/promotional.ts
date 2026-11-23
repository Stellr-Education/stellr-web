// Promotional event mail (email plan Workstream B, 23 Nov 2026).
//
// An event email marked promotional is community mail, not logistics: it goes
// only to members who have marketing consent, never to a minor (the same rule
// as campaigns, lib/email-campaigns.ts), from the community stream's domain,
// and carries one-click unsubscribe in the headers and a visible link in the
// body (CAN-SPAM; Gmail and Yahoo bulk-sender rules). Recipients without a
// member record cannot be checked for consent, so they are left out.

import type { SupabaseClient } from '@supabase/supabase-js'
import { unsubscribeUrl } from '@/lib/email/unsubscribe-url'
import { escapeHtml } from '@/lib/email-layout'
import type { ResolvedRecipient } from './audiences'

const MINOR_AGE_BRACKET = 'high_school'

export interface PromotionalAudience {
  /** The recipients who may receive it, in the original order. */
  eligible: ResolvedRecipient[]
  /** How many were left out (no member record, no consent, a minor, or no token). */
  excluded: number
  /** memberId → that member's one-click unsubscribe URL. */
  unsubscribe: Map<string, string>
}

export async function promotionalAudience(db: SupabaseClient, recipients: ResolvedRecipient[]): Promise<PromotionalAudience> {
  const ids = [...new Set(recipients.map((r) => r.memberId).filter((id): id is string => !!id))]
  const unsubscribe = new Map<string, string>()
  if (ids.length) {
    const { data, error } = await db
      .from('members')
      .select('id, marketing_consent, age_bracket, marketing_unsubscribe_token')
      .in('id', ids)
    // Fail closed: without a trustworthy consent read nobody gets promotional mail.
    if (error) throw new Error(`promotional consent read failed: ${error.message}`)
    for (const m of (data ?? []) as { id: string; marketing_consent: boolean | null; age_bracket: string | null; marketing_unsubscribe_token: string | null }[]) {
      if (m.marketing_consent === true && m.age_bracket && m.age_bracket !== MINOR_AGE_BRACKET && m.marketing_unsubscribe_token) {
        unsubscribe.set(m.id, unsubscribeUrl(m.marketing_unsubscribe_token))
      }
    }
  }
  const eligible = recipients.filter((r) => !!r.memberId && unsubscribe.has(r.memberId))
  return { eligible, excluded: recipients.length - eligible.length, unsubscribe }
}

/** RFC 8058 one-click unsubscribe headers, as campaigns send them. */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
}

/** The visible footer: why they got it, and how to stop. */
export function withUnsubscribeFooter(content: { html: string; text: string }, url: string): { html: string; text: string } {
  const html = `${content.html}
<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#555555;margin:24px 0 0">You're getting this because you're a Stellr Education member who said yes to news and updates. <a href="${escapeHtml(url)}" style="color:#555555">Unsubscribe</a></p>`
  const text = `${content.text}\n--\nYou're getting this because you're a Stellr Education member who said yes to news and updates.\nUnsubscribe: ${url}\n`
  return { html, text }
}
