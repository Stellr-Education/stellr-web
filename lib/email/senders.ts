// The sender registry: the one place that says which address a kind of mail
// goes out from. Email plan Workstream B (23 Nov 2026).
//
// Two streams, so a community newsletter's reputation can never drag down a
// guardian-consent email:
//   • transactional — mail.stellreducation.org, on Resend Forge, no open or
//     click tracking. Registration, consent, credentials, receipts, and event
//     logistics to families who registered.
//   • community     — community.stellreducation.org once it is verified in
//     Resend, with open and click tracking. Campaigns, promotional event mail,
//     gated-asset follow-ups. Always carries one-click unsubscribe.
//
// Addresses come from the environment so a domain can switch without a
// deploy. Until COMMUNITY_FROM is set the community stream keeps today's
// address on mail.stellreducation.org (MARKETING_FROM), which is what Resend
// Free's single domain allowed.

import type { EmailKind } from '@/lib/email-budget'

export type EmailStream = 'transactional' | 'community'

const DEFAULT_TRANSACTIONAL_FROM = 'Stellr Education <no-reply@mail.stellreducation.org>'
const DEFAULT_COMMUNITY_FROM = 'Stellr Education <hello@mail.stellreducation.org>'

/** The stream a send belongs to, from how it is weighed against the budget. */
export function streamForKind(kind: EmailKind): EmailStream {
  return kind === 'marketing' ? 'community' : 'transactional'
}

/** The default From for a stream. Read at call time so a Vercel env change takes effect on the next request. */
export function streamFrom(stream: EmailStream): string {
  if (stream === 'community') {
    return process.env.COMMUNITY_FROM || process.env.MARKETING_FROM || DEFAULT_COMMUNITY_FROM
  }
  return process.env.TRANSACTIONAL_FROM || DEFAULT_TRANSACTIONAL_FROM
}

/** The bare address inside a From header ("Name <a@b>" or "a@b"). */
export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim()
}

/** The domain a From header sends on, lower-cased. */
export function domainOf(from: string): string {
  return addressOf(from).split('@')[1]?.toLowerCase() ?? ''
}

/**
 * Keep a sender's display name but move it onto the community stream's
 * domain. Event emails go out as a person ("David Shaw, Stellr Education");
 * a promotional one keeps that name and local part but sends from the
 * community domain, so it is tracked and its reputation stays apart.
 */
export function onCommunityDomain(from: string): string {
  const community = domainOf(streamFrom('community'))
  const addr = addressOf(from)
  const local = addr.split('@')[0]
  if (!community || !local) return from
  const name = from.includes('<') ? from.slice(0, from.indexOf('<')).trim() : ''
  return name ? `${name} <${local}@${community}>` : `${local}@${community}`
}
