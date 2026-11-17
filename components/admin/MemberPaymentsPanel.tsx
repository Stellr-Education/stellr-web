// A member's paid places on the admin member page, each with its Receipt and
// Invoice to download and pass on (lib/payments). The links' routes check again,
// event by event, that the viewer may have them.

export interface MemberPayment {
  participantId: string
  registrationId: string
  eventTitle: string
  /** When it was paid: the invoice's paid date, or the registration date for a card payment. */
  date: string | null
  how: 'card' | 'invoice'
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' })
}

export function MemberPaymentsPanel({ payments }: { payments: MemberPayment[] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-content-muted">No paid places yet.</p>
  }
  const link = 'font-medium text-primary hover:text-ink'
  return (
    <ul className="divide-y divide-line text-sm">
      {payments.map((p) => (
        <li key={p.participantId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
          <div>
            <p className="font-medium text-ink">{p.eventTitle}</p>
            <p className="text-xs text-content-muted">
              {p.how === 'invoice' ? 'Paid by invoice' : 'Paid by card'} · {shortDate(p.date)}
            </p>
          </div>
          <p className="flex gap-3 text-sm">
            <a
              href={`/api/admin/registrations/${p.registrationId}/receipt?participant=${p.participantId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={link}
            >
              Receipt
            </a>
            <a href={`/api/admin/registrations/${p.registrationId}/paid-invoice?participant=${p.participantId}`} className={link}>
              Invoice
            </a>
          </p>
        </li>
      ))}
    </ul>
  )
}
