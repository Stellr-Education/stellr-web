/**
 * lib/support/consent-status.ts — what a break-glass request (a support_consents row) is
 * now, for the console (S6-BG, S6-SUP-UI). Pure, so the console and its tests agree.
 */
export type ConsentStatus = 'pending' | 'approved' | 'declined' | 'withdrawn' | 'used' | 'lapsed'

export interface ConsentTimes {
  expires_at: string
  approved_at: string | null
  declined_at: string | null
  withdrawn_at: string | null
  used_at: string | null
}

/** Used and declined are final; withdrawn next; then lapse; then the tenant's answer. */
export function consentStatus(c: ConsentTimes, now: number = Date.now()): ConsentStatus {
  if (c.used_at) return 'used'
  if (c.declined_at) return 'declined'
  if (c.withdrawn_at) return 'withdrawn'
  if (Date.parse(c.expires_at) <= now) return 'lapsed'
  return c.approved_at ? 'approved' : 'pending'
}

/** Words for each status, in the console's voice. */
export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  pending: 'Waiting for the organization',
  approved: 'Approved, ready to use',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  used: 'Used',
  lapsed: 'Lapsed',
}
