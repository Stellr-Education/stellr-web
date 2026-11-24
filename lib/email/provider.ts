// Which provider sends: Resend, or the SES warm standby (email plan F).
//
// EMAIL_PROVIDER=ses is set by a person, by hand, in Vercel, and taken off again
// the same way (docs/RUNBOOK-email-standby.md). There is no automatic switching.
// While SES is on, community (marketing) mail is held in the outbox: it keeps its
// tracked domain and its reputation apart, and waits for Resend.

import type { EmailKind } from '@/lib/email-budget'
import { resendTransport, type EmailTransport } from './transport'
import { sesTransport } from './transport-ses'

export type EmailProviderName = 'resend' | 'ses'

/** Read at call time, so the switch takes effect on the next request after a redeploy. */
export function emailProvider(): EmailProviderName {
  return (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase() === 'ses' ? 'ses' : 'resend'
}

/** True when a message of this kind must wait rather than go through the standby. */
export function heldOnStandby(kind: EmailKind): boolean {
  return emailProvider() === 'ses' && kind === 'marketing'
}

/** The transport for this send, or null when there is none (no Resend key while on Resend). */
export function activeTransport(resendApiKey: string | undefined): EmailTransport | null {
  if (emailProvider() === 'ses') return sesTransport()
  return resendApiKey ? resendTransport(resendApiKey) : null
}
