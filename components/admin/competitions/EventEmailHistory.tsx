'use client'

import { Fragment, useMemo, useState } from 'react'
import { Button } from '@stellr/web-ui'
import { AUDIENCES, ROLE_LABEL, type EventEmailRow, type EventEmailSendRow } from '@/lib/event-emails/types'
import {
  groupSends, sendGroupCsv, OUTCOME_LABEL, PROBLEM_OUTCOMES,
  type GroupRecipient, type RecipientOutcome, type SendGroup,
} from '@/lib/event-emails/send-groups'
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
function timeOnly(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' })
}

const audienceLabel = (key: string) => AUDIENCES.find((a) => a.key === key)?.label ?? key
const roleLabel = (r: string) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r

const STATUS_PILL: Record<SendGroup['status']['kind'], { label: string; className: string }> = {
  sending:                { label: 'Sending',                className: 'bg-primary-soft text-primary' },
  paused:                 { label: 'Paused part-way',        className: 'bg-orange-100 text-orange-700' },
  finished:               { label: 'Finished',               className: 'bg-green-100 text-green-700' },
  finished_with_problems: { label: 'Finished — check below', className: 'bg-red-100 text-red-700' },
  stopped:                { label: 'Stopped',                className: 'bg-line-light text-content-body' },
}

const OUTCOME_CLASS: Record<RecipientOutcome, string> = {
  delivered: 'text-green-700',
  blocked: 'text-red-600',
  suppressed: 'text-orange-700',
  failed: 'text-red-600',
  unconfirmed: 'text-orange-700',
  sending: 'text-primary',
  waiting: 'text-content-body',
  left_list: 'text-content-muted',
}

const OUTCOME_HELP: Record<RecipientOutcome, string> = {
  delivered: 'Handed to our email provider. Opens are not tracked.',
  blocked: 'Accepted, but the address has since bounced or marked us as spam. Fix the address on their record.',
  suppressed: 'Not sent: this address bounced or complained before. Fix the address on their record.',
  failed: 'Our email provider refused it.',
  unconfirmed: 'The run was cut off while sending to them, so it may or may not have gone. It is not re-sent automatically, to avoid a duplicate.',
  sending: 'Being sent right now.',
  waiting: 'Not reached yet. The next run sends it.',
  left_list: 'No longer in the group by their turn (for example, they had signed), so not emailed.',
}

const needsLook = (p: GroupRecipient) => PROBLEM_OUTCOMES.includes(p.outcome) || p.times > 1

// "37 delivered · 1 not sent · 8 left the group": every outcome that has anyone.
function CountLine({ g }: { g: SendGroup }) {
  const parts = (Object.keys(OUTCOME_LABEL) as RecipientOutcome[])
    .filter((o) => g.counts[o] > 0)
    .map((o) => (
      <span key={o} className={OUTCOME_CLASS[o]}>
        {g.counts[o]} {OUTCOME_LABEL[o].toLowerCase()}
      </span>
    ))
  if (g.duplicates > 0) parts.push(<span key="dup" className="text-orange-700">{g.duplicates} emailed twice</span>)
  if (!parts.length) return <span className="text-content-muted">Nobody matched these groups when it ran</span>
  return <>{parts.map((p, i) => <Fragment key={i}>{i > 0 && <span className="text-content-muted"> · </span>}{p}</Fragment>)}</>
}

function StatusCell({ g, onOpenEmail }: { g: SendGroup; onOpenEmail?: (id: string) => void }) {
  const pill = STATUS_PILL[g.status.kind]
  const done = g.recipients.filter((p) => p.outcome !== 'waiting' && p.outcome !== 'sending').length
  const sub = 'mt-1 block text-xs text-content-body'
  return (
    <>
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${pill.className}`}>{pill.label}</span>
      <span className="mt-1 block text-sm"><CountLine g={g} /></span>
      {g.status.kind === 'sending' && <span className={sub}>{done} of {g.recipients.length} done so far.</span>}
      {g.status.kind === 'paused' && (
        <span className={sub}>
          {g.counts.waiting > 0 ? `${g.counts.waiting} still to go. ` : ''}
          {g.status.resumeNow ? 'Carries on with “Resume now” or ' : 'Carries on '}
          at the next scheduled run, about {g.status.nextRunAt ? `${when(g.status.nextRunAt)} MT` : 'tomorrow'}.
          {g.status.resumeNow && g.emailId && onOpenEmail && (
            <Button variant="primary" className="ml-2 !px-3 !py-1 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onOpenEmail(g.emailId!) }}>
              Open to resume
            </Button>
          )}
        </span>
      )}
      {(g.status.kind === 'finished' || g.status.kind === 'finished_with_problems') && g.runs.length > 1 && (
        <span className={sub}>Everyone is accounted for. Sent in {g.runs.length} runs; the last finished at {timeOnly(g.runs[g.runs.length - 1].finished_at ?? g.lastRunAt)}.</span>
      )}
      {g.docusignResent > 0 && <span className={sub}>{g.docusignResent} DocuSign re-sent</span>}
    </>
  )
}

function download(g: SendGroup) {
  const blob = new Blob([sendGroupCsv(g, roleLabel)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${g.emailName.replace(/[^\w-]+/g, '-').toLowerCase()}-${g.startedAt.slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Detail({ g }: { g: SendGroup }) {
  const flagged = g.recipients.filter(needsLook)
  const [filter, setFilter] = useState<'all' | 'problems'>(flagged.length ? 'problems' : 'all')
  const shown = filter === 'all' ? g.recipients : flagged
  const hiddenLeft = g.counts.left_list - g.recipients.filter((p) => p.outcome === 'left_list').length
  const tab = (on: boolean) => `rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-primary text-white' : 'border border-line bg-white text-content-body'}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={tab(filter === 'problems')} onClick={() => setFilter('problems')}>
          Needs a look ({flagged.length})
        </button>
        <button type="button" className={tab(filter === 'all')} onClick={() => setFilter('all')}>
          Everyone ({g.recipients.length})
        </button>
        <button type="button" className="ml-auto text-xs font-medium text-primary hover:text-primary-deep" onClick={() => download(g)}>
          Download CSV
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-content-muted">Nothing needs a look: everyone it reached was delivered.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-light bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line-light text-left uppercase tracking-wide text-content-muted">
                <th className="px-3 py-1.5 font-medium">Who</th>
                <th className="px-3 py-1.5 font-medium">Address</th>
                <th className="px-3 py-1.5 font-medium">Result</th>
                <th className="px-3 py-1.5 font-medium">Run (MT)</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => <RecipientRow key={p.email} p={p} />)}
            </tbody>
          </table>
        </div>
      )}

      {hiddenLeft > 0 && (
        <p className="text-xs text-content-body">
          {hiddenLeft} {hiddenLeft === 1 ? 'person was' : 'people were'} in the group when it started but not by their turn (for example, they signed in between), so {hiddenLeft === 1 ? 'was' : 'were'} not emailed. Runs before 18 Nov 2026 did not record their names.
        </p>
      )}

      {g.runs.length > 1 && (
        <details className="text-xs text-content-body">
          <summary className="cursor-pointer font-medium">The {g.runs.length} runs</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {g.runs.map((r) => {
              const handled = r.recipients.filter((x) => x.status !== 'not_reached').length
              return (
                <li key={r.id}>
                  {when(r.started_at)} · {r.triggered_by === 'resume' ? 'Resumed' : TRIGGER_LABEL[r.trigger]}
                  {r.triggered_by && r.triggered_by !== 'resume' && r.triggered_by !== 'schedule' ? ` (${r.triggered_by})` : ''}
                  {' · '}{handled} of {r.recipient_count} reached
                  {r.finished_at == null ? ' · cut off' : handled < r.recipient_count ? ' · stopped at its time limit' : ''}
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}

function RecipientRow({ p }: { p: GroupRecipient }) {
  const detail = p.error
    ?? (p.blockedReason ? `Address ${p.blockedReason === 'complaint' ? 'marked us as spam' : p.blockedReason === 'bounce' ? 'bounced' : p.blockedReason}.` : OUTCOME_HELP[p.outcome])
  return (
    <tr className="border-b border-line-light align-top last:border-0">
      <td className="px-3 py-1.5 text-ink">
        {p.name !== p.email ? <MemberLink memberId={p.memberId}>{p.name}</MemberLink> : '—'}
        {p.roles.length > 0 && <span className="block text-content-muted">{p.roles.map(roleLabel).join(', ')}</span>}
      </td>
      <td className="px-3 py-1.5 text-content-body">{p.email}</td>
      <td className="px-3 py-1.5">
        <span className={`font-medium ${OUTCOME_CLASS[p.outcome]}`}>{OUTCOME_LABEL[p.outcome]}</span>
        {p.times > 1 && <span className="ml-1 text-orange-700">· emailed {p.times} times</span>}
        <span className="block text-content-muted">{detail}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-content-body">{p.outcome === 'left_list' ? '—' : when(p.at)}</td>
    </tr>
  )
}

// Every send from this tab. An email's runs are ONE row: a big send can take
// several runs, and what matters is whether everyone has had it. Counts only:
// there is deliberately no open/read tracking. Expanding a row lists each person.
export function EventEmailHistory({
  history,
  emails = [],
  onOpenEmail,
}: {
  history: EventEmailSendRow[]
  emails?: Pick<EventEmailRow, 'id' | 'status' | 'updated_at'>[]
  onOpenEmail?: (emailId: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const groups = useMemo(() => groupSends(history, emails), [history, emails])

  if (groups.length === 0) {
    return <p className="text-sm text-content-muted">Nothing has been sent from this tab yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-light text-left text-xs uppercase tracking-wide text-content-muted">
            <th className="px-4 py-2 font-medium">Started (MT)</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Sent to</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">How</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr
                className="cursor-pointer border-b border-line-light align-top last:border-0 hover:bg-surface"
                onClick={() => setOpen(open === g.key ? null : g.key)}
                aria-expanded={open === g.key}
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-content-body">
                  {when(g.startedAt)}
                  {g.runs.length > 1 && <span className="block text-xs text-content-muted">last run {when(g.lastRunAt)}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-ink">{g.emailName}</p>
                  <p className="text-xs text-content-muted">{g.subject}</p>
                </td>
                <td className="px-4 py-2.5 text-content-body">
                  {g.audiences.map(audienceLabel).join(', ')}
                  <span className="block text-xs text-content-muted">{g.planned} when it started</span>
                </td>
                <td className="max-w-sm px-4 py-2.5">
                  <StatusCell g={g} onOpenEmail={onOpenEmail} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-content-body">
                  {TRIGGER_LABEL[g.trigger]}
                  {g.triggeredBy && g.trigger !== 'schedule' && (
                    <span className="block text-xs text-content-muted">{g.triggeredBy}</span>
                  )}
                </td>
              </tr>
              {open === g.key && (
                <tr className="border-b border-line-light bg-surface">
                  <td colSpan={5} className="px-4 py-3">
                    <Detail g={g} />
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
