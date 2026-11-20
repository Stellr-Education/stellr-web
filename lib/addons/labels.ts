// Event add-ons: status words people see (copy per VOICE.md). Client-safe.

export const LINE_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Not yet paid',
  pending_consent: 'Awaiting overnight consent',
  confirmed: 'Booked',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  expired: 'Released',
}

export const PAYER_LABEL: Record<string, string> = {
  group: 'Paid by the group',
  self: 'Paid by the person',
  included: 'Waived',
  offline: 'Paid offline',
}

/** The full FR-5a message: what, why, and what to do. */
export function minorIndividualMessage(addonTitle: string): string {
  return (
    `${addonTitle} is only available to students under 18 who are travelling with a school or group. ` +
    'An overnight stay needs a responsible adult from the student’s own group. ' +
    'To book it, join or register with a school or group for this event, or contact Stellr and we’ll help arrange it.'
  )
}
