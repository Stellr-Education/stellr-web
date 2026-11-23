// Mail that may not be going out, for the admin dashboard (/admin): an outbox
// whose latest run failed or that has not succeeded in time
// (resend-quota-outbox.5), and other tenants' signing invitations held for want
// of a sender (B14b), and 7-day bounce and complaint rates per stream from
// email_events (email plan, Workstream C). Server component: it only renders
// what lib/admin-digest loaded. Counts and times only, never an address or a
// tenant's details.

import { AlertTriangle, MailWarning } from 'lucide-react'
import { stuckOutboxes, type OutboxHealth } from '@/lib/admin-digest'
import { BOUNCE_RATE_ALERT, COMPLAINT_RATE_ALERT, RATE_MIN_SENDS, RATE_WINDOW_DAYS, type StreamRates } from '@/lib/email/events-health'
import { formatDateTime } from '@/lib/utils'

function pct(rate: number | null, digits: number): string {
  return rate == null ? '—' : `${(rate * 100).toFixed(digits)}%`
}

function DeliveryRates({ rates }: { rates: readonly StreamRates[] }) {
  const alert = rates.some((r) => r.alert)
  return (
    <div
      role={alert ? 'alert' : 'status'}
      className={`rounded-ds-card border px-4 py-3 text-sm ${alert ? 'border-pathway-amber bg-pathway-amber-bg text-gold-ink' : 'border-line bg-white text-content-body'}`}
    >
      <p className="font-medium text-ink">Email delivery, last {RATE_WINDOW_DAYS} days</p>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wide text-content-muted">
            <th className="py-1 pr-3 font-medium">Stream</th>
            <th className="py-1 pr-3 text-right font-medium">Sent</th>
            <th className="py-1 pr-3 text-right font-medium">Bounced</th>
            <th className="py-1 text-right font-medium">Spam reports</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.label} className={r.alert ? 'font-medium' : undefined}>
              <td className="py-1 pr-3">{r.label}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{r.sent.toLocaleString()}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{r.bounced.toLocaleString()} ({pct(r.bounceRate, 1)})</td>
              <td className="py-1 text-right tabular-nums">{r.complained.toLocaleString()} ({pct(r.complaintRate, 2)})</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs">
        {alert
          ? <>A stream is over the line mailbox providers act on: {pct(BOUNCE_RATE_ALERT, 0)} bounced or {pct(COMPLAINT_RATE_ALERT, 1)} spam reports, over at least {RATE_MIN_SENDS} sends. Check who it went to before sending more.</>
          : <>Mailbox providers act at {pct(BOUNCE_RATE_ALERT, 0)} bounced or {pct(COMPLAINT_RATE_ALERT, 1)} spam reports (counted from {RATE_MIN_SENDS} sends).</>}
      </p>
    </div>
  )
}

function outboxSentence(o: OutboxHealth): string {
  return o.state === 'failed'
    ? `The latest run failed (${formatDateTime(o.lastRunAt)}).`
    : `No successful run in the last ${o.windowHours} hours.`
}

export function MailHealth({
  outboxes,
  heldSigningInvites,
  showHeld,
  mailRates,
}: {
  outboxes: readonly OutboxHealth[] | undefined
  heldSigningInvites: number | null | undefined
  /** Platform admins only: the held count and the rates concern other tenants. */
  showHeld: boolean
  mailRates?: readonly StreamRates[]
}) {
  const stuck = stuckOutboxes(outboxes)
  const held = showHeld && heldSigningInvites ? heldSigningInvites : 0
  const rates = showHeld && mailRates?.length ? mailRates : []
  if (stuck.length === 0 && held === 0 && rates.length === 0) return null

  return (
    <section aria-labelledby="mail-health-heading" className="space-y-3">
      <h2 id="mail-health-heading" className="sr-only">Mail health</h2>
      {stuck.map((o) => (
        <div
          key={o.key}
          role="alert"
          className={`flex gap-3 rounded-ds-card border px-4 py-3 text-sm ${
            o.state === 'failed' ? 'border-danger/30 bg-danger/5 text-danger' : 'border-pathway-amber bg-pathway-amber-bg text-gold-ink'
          }`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p>
              <strong>{o.label}:</strong> {outboxSentence(o)}{' '}
              {o.lastSuccessAt
                ? <>Last successful run {formatDateTime(o.lastSuccessAt)}.</>
                : <>No successful run on record.</>}
            </p>
            {o.detail && <p className="mt-1 text-xs">{o.detail}.</p>}
          </div>
        </div>
      ))}
      {held > 0 && (
        <div role="status" className="flex gap-3 rounded-ds-card border border-pathway-amber bg-pathway-amber-bg px-4 py-3 text-sm text-gold-ink">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            <strong>
              {held.toLocaleString()} signing invitation{held === 1 ? '' : 's'} held.
            </strong>{' '}
            {held === 1 ? 'It is' : 'They are'} for other organisers with no email sender set up yet, so nothing has been sent.
            {' '}{held === 1 ? 'It goes' : 'They go'} out once the organiser&rsquo;s sender is in place.
          </p>
        </div>
      )}
      {rates.length > 0 && <DeliveryRates rates={rates} />}
    </section>
  )
}
