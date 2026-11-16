// The registration-status pill on /events cards. Event (Challenge) cards and
// Classroom Qualifier cards share this map so the two can't drift apart.

export type RegistrationStatusKey = 'open' | 'coming-soon' | 'closed'

export const registrationStatusConfig: Record<RegistrationStatusKey, { label: string; className: string }> = {
  open: { label: 'Registration Open', className: 'bg-green-100 text-green-700' },
  'coming-soon': { label: 'Coming Soon', className: 'bg-surface text-content-body' },
  closed: { label: 'Registration Closed', className: 'bg-red-100 text-red-700' },
}

export function RegistrationStatusPill({ status }: { status: RegistrationStatusKey }) {
  const { label, className } = registrationStatusConfig[status]
  return <span className={`text-xs font-semibold px-2 py-1 rounded-full ${className}`}>{label}</span>
}
