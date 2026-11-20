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
