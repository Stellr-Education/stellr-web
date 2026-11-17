'use client'

import { Fragment, useState } from 'react'
import { AUDIENCES, ROLE_LABEL, type EventEmailSendRow } from '@/lib/event-emails/types'
import { MemberLink } from '@/components/admin/RecordLinks'

const TRIGGER_LABEL: Record<EventEmailSendRow['trigger'], string> = {
  manual: 'Sent now',
  schedule: 'Scheduled',
  test: 'Test',
  catch_up: 'Late registrants',
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver',
  })
}

const audienceLabel = (key: string) => AUDIENCES.find((a) => a.key === key)?.label ?? key

/** A run with no finish time this long after it started was cut off, not still going. */
const CUT_OFF_AFTER_MS = 2 * 60_000

type Recipient = EventEmailSendRow['recipients'][number]
const notDelivered = (r: Recipient) => r.status === 'suppressed' || (!!r.blocked && r.status !== 'failed')

// What the Result column says. A send can take more than one run (each stops at
// its time limit and the next carries on), so "18 of 38" is normal, not an error.
function Result({ h }: { h: EventEmailSendRow }) {
  const reached = h.recipients.length
  const blocked = h.recipients.filter(notDelivered).length
  const delivered = h.recipients.filter((r) => (r.status === 'sent' || r.status === 'queued') && !notDelivered(r)).length
  const sub = 'block text-xs text-content-muted'
  if (h.finished_at == null) {
    const cutOff = Date.now() - new Date(h.started_at).getTime() > CUT_OFF_AFTER_MS
    return cutOff ? (
      <>
        <span className="text-orange-700">Cut off — {reached} of {h.recipient_count} reached</span>
        <span className={sub}>The rest carry on with “Resume now” or at the next scheduled run.</span>
      </>
    ) : (
      <span className="text-content-body">Sending… {reached} of {h.recipient_count}</span>
    )
  }
  const carried = h.recipient_count - reached
  return (
    <>
      <span className="text-ink">{delivered} sent</span>
      {h.failed_count > 0 && <span className="ml-2 text-red-600">{h.failed_count} failed</span>}
      {blocked > 0 && <span className={sub}>{blocked} not delivered (address blocked)</span>}
      {carried > 0 && <span className={sub}>Stopped at its time limit — {carried} carried on in the next run</span>}
      {h.docusign_resent > 0 && <span className={sub}>{h.docusign_resent} DocuSign re-sent</span>}
    </>
  )
}

function statusNote(r: Recipient): string {
  if (r.status === 'failed') return ` — failed${r.error ? `: ${r.error}` : ''}`
  if (r.status === 'suppressed') return ' — not delivered: this address bounced or complained before'
  if (r.blocked) return ` — not delivered: address blocked (${r.blocked === 'complaint' ? 'spam complaint' : r.blocked})`
  if (r.status === 'queued') return ' — queued (sent from the outbox)'
  return ''
}

// Every send from this tab — manual, scheduled and tests. Counts only: there is
// deliberately no open/read tracking. Expanding a row lists who it went to.
export function EventEmailHistory({ history }: { history: EventEmailSendRow[] }) {
  const [open, setOpen] = useState<string | null>(null)

  if (history.length === 0) {
    return <p className="text-sm text-brand-muted-soft">Nothing has been sent from this tab yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-hairline text-left text-xs uppercase tracking-wide text-brand-muted-soft">
            <th className="px-4 py-2 font-medium">When (MT)</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Sent to</th>
            <th className="px-4 py-2 font-medium">Result</th>
            <th className="px-4 py-2 font-medium">How</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <Fragment key={h.id}>
              <tr
                className="cursor-pointer border-b border-brand-hairline last:border-0 hover:bg-surface"
                onClick={() => setOpen(open === h.id ? null : h.id)}
                aria-expanded={open === h.id}
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-brand-muted">{when(h.started_at)}</td>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-ink">{h.email_name}</p>
                  <p className="text-xs text-brand-muted-soft">{h.subject}</p>
                </td>
                <td className="px-4 py-2.5 text-brand-muted">{h.audiences.map(audienceLabel).join(', ')}</td>
                <td className="max-w-xs px-4 py-2.5">
                  <Result h={h} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-brand-muted">
                  {TRIGGER_LABEL[h.trigger]}
                  {h.triggered_by && h.trigger !== 'schedule' && (
                    <span className="block text-xs text-brand-muted-soft">
                      {h.triggered_by === 'schedule' ? 'Automatic' : h.triggered_by}
                    </span>
                  )}
                </td>
              </tr>
              {open === h.id && (
                <tr className="border-b border-brand-hairline bg-surface">
                  <td colSpan={5} className="px-4 py-3">
                    {h.recipients.length === 0 ? (
                      <p className="text-xs text-brand-muted-soft">Nobody matched these groups when it ran.</p>
                    ) : (
                      <ul className="grid gap-1 text-xs sm:grid-cols-2">
                        {h.recipients.map((r) => (
                          <li key={r.email} className={r.status === 'failed' ? 'text-red-600' : notDelivered(r) ? 'text-orange-700' : 'text-brand-muted'}>
                            {r.name !== r.email && (
                              <span className="text-ink">
                                <MemberLink memberId={r.memberId}>{r.name}</MemberLink> ·{' '}
                              </span>
                            )}
                            {r.email}
                            {r.roles.length > 0 && ` (${r.roles.map((x) => ROLE_LABEL[x] ?? x).join(', ')})`}
                            {statusNote(r)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
