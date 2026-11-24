'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'
import { useStepUpFetch } from '@/components/admin/use-step-up-fetch'

const input = 'w-full rounded-md border border-line-strong px-3 py-2 text-sm text-ink disabled:opacity-60'

/**
 * Email plan D2: edit a tenant's sender and manage its own sending domain. Each
 * change asks for a fresh sign-in factor (useStepUpFetch) and is recorded on the
 * tenant's audit log by the API.
 */
export function TenantEmailForm({
  tenantId,
  hasDomain,
  fromName,
  fromLocalPart,
  replyTo,
  bulkDailyCap,
  bulkMonthlyCap,
  bulkPaused,
}: {
  tenantId: string
  hasDomain: boolean
  fromName: string
  fromLocalPart: string
  replyTo: string
  bulkDailyCap: number | null
  bulkMonthlyCap: number | null
  bulkPaused: boolean
}) {
  const router = useRouter()
  const stepUpFetch = useStepUpFetch()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [name, setName] = useState(fromName)
  const [local, setLocal] = useState(fromLocalPart)
  const [reply, setReply] = useState(replyTo)
  const [domain, setDomain] = useState('')
  const [daily, setDaily] = useState(bulkDailyCap == null ? '' : String(bulkDailyCap))
  const [monthly, setMonthly] = useState(bulkMonthlyCap == null ? '' : String(bulkMonthlyCap))
  const capOf = (v: string) => (v.trim() === '' ? null : Number(v))

  async function act(action: string, body: Record<string, unknown> = {}, done = 'Saved.') {
    setBusy(action)
    setMessage(null)
    try {
      const res = await stepUpFetch(`/api/admin/platform/tenants/${tenantId}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setMessage({ ok: false, text: data?.error ?? 'That didn’t work. Try again.' })
        return
      }
      setMessage({ ok: true, text: done })
      if (action === 'add_domain') setDomain('')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-content-body">Sender name</span>
          <input className={input} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Their organisation’s name" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-content-body">Address before the @</span>
          <input className={input} value={local} maxLength={64} onChange={(e) => setLocal(e.target.value)} />
          <span className="mt-0.5 block text-xs text-content-muted">Used only on their own domain.</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-content-body">Replies go to</span>
          <input className={input} type="email" value={reply} maxLength={254} onChange={(e) => setReply(e.target.value)} />
        </label>
      </div>
      <Button
        variant="secondaryStrong"
        disabled={busy !== null}
        onClick={() => act('save', { from_name: name || null, from_local_part: local, reply_to: reply || null })}
      >
        {busy === 'save' ? 'Saving…' : 'Save sender'}
      </Button>

      <div className="border-t border-line-light pt-4">
        <p className="text-sm font-medium text-content-body">Event blasts</p>
        <p className="mt-0.5 text-xs text-content-muted">
          Caps on sends to a whole event. Mail to one person (receipts, consent forms) is never capped or paused.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-content-body">A day</span>
            <input className={input} inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="No cap" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-content-body">A month</span>
            <input className={input} inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="No cap" />
          </label>
          <Button
            variant="secondaryStrong"
            disabled={busy !== null}
            onClick={() => act('save', { bulk_daily_cap: capOf(daily), bulk_monthly_cap: capOf(monthly) }, 'Caps saved.')}
          >
            {busy === 'save' ? 'Saving…' : 'Save caps'}
          </Button>
          {bulkPaused ? (
            <Button variant="secondaryStrong" disabled={busy !== null} onClick={() => act('resume_bulk', {}, 'Event blasts can go again.')}>
              {busy === 'resume_bulk' ? 'Resuming…' : 'Resume blasts'}
            </Button>
          ) : (
            <Button
              variant="secondaryStrong"
              disabled={busy !== null}
              onClick={() => {
                const reason = window.prompt('Why pause their event blasts? (They’ll see nothing; this is for staff.)')
                if (reason !== null) void act('pause_bulk', { reason }, 'Event blasts paused.')
              }}
            >
              {busy === 'pause_bulk' ? 'Pausing…' : 'Pause blasts'}
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-line-light pt-4">
        {hasDomain ? (
          <div className="flex flex-wrap gap-3">
            <Button variant="secondaryStrong" disabled={busy !== null} onClick={() => act('check', {}, 'Checked. The status above is up to date.')}>
              {busy === 'check' ? 'Checking…' : 'Check DNS now'}
            </Button>
            <Button
              variant="secondaryStrong"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm('Remove this domain? Their mail goes back to “via Stellr” straight away.')) void act('remove_domain', {}, 'Domain removed.')
              }}
            >
              {busy === 'remove_domain' ? 'Removing…' : 'Remove domain'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-64 flex-1 text-sm">
              <span className="mb-1 block font-medium text-content-body">Their own sending domain</span>
              <input className={input} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mail.example.org" />
              <span className="mt-0.5 block text-xs text-content-muted">A subdomain keeps their staff mailboxes separate.</span>
            </label>
            <Button variant="secondaryStrong" disabled={busy !== null || !domain.trim()} onClick={() => act('add_domain', { domain }, 'Added. Send them the DNS records above.')}>
              {busy === 'add_domain' ? 'Adding…' : 'Add domain'}
            </Button>
          </div>
        )}
      </div>

      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-enviro-green-text' : 'text-danger'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
