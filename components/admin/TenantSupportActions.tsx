'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Field, Input, Textarea } from '@stellr/web-ui'
import { useStepUpFetch } from '@/components/admin/use-step-up-fetch'
import { CONSENT_STATUS_LABELS, type ConsentStatus } from '@/lib/support/consent-status'

const REASON_MIN = 20

export interface PanelConsent {
  id: string
  requestedAt: string
  expiresAt: string
  status: ConsentStatus
}

export interface PanelSession {
  mode: 'read' | 'break_glass'
  endsAt: number
  /** The session is on this organization. */
  here: boolean
  tenantName: string
}

type Action = 'read' | 'request' | 'open' | 'renew' | 'end'

const ENDPOINTS: Record<Action, { url: string; method: string }> = {
  read: { url: '/api/admin/support/session', method: 'POST' },
  request: { url: '/api/admin/support/consent', method: 'POST' },
  open: { url: '/api/admin/support/break-glass', method: 'POST' },
  renew: { url: '/api/admin/support/break-glass', method: 'PATCH' },
  end: { url: '/api/admin/support/session', method: 'DELETE' },
}

const time = (ms: number | string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(ms))

/**
 * S6-SUP-UI: the support panel's buttons. Each calls one support route through
 * useStepUpFetch, so a route that needs a fresh sign-in factor (break-glass always does)
 * opens Clerk's "confirm it's you" dialog and retries. The routes make every check; this
 * only decides which buttons make sense to show.
 */
export function TenantSupportActions({
  tenantId,
  session,
  consents,
  readFailed,
}: {
  tenantId: string
  session: PanelSession | null
  consents: PanelConsent[]
  readFailed?: boolean
}) {
  const router = useRouter()
  const stepUpFetch = useStepUpFetch()
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= REASON_MIN
  const approved = consents.find((c) => c.status === 'approved')

  async function run(action: Action, body?: Record<string, unknown>) {
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      const { url, method } = ENDPOINTS[action]
      const res = await stepUpFetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? 'That didn’t work. Try again.')
        return
      }
      if (action === 'request') setNotice('Request sent. One of their admins needs to approve it within 24 hours.')
      if (action !== 'end') setReason('')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const reasonField = (label: string) => (
    <Field label={label} hint={`At least ${REASON_MIN} characters, such as the ticket and what you need to do.`}>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
    </Field>
  )

  return (
    <div className="space-y-4">
      {session && !session.here && (
        <p className="text-sm text-ink">
          You have a {session.mode === 'break_glass' ? 'break-glass' : 'read'} session open on {session.tenantName} until{' '}
          {time(session.endsAt)}. End it before starting one here.
        </p>
      )}

      {session?.here ? (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            {session.mode === 'break_glass' ? 'Break-glass is open' : 'A read-only session is open'} until {time(session.endsAt)}.{' '}
            <Link href="/admin/platform/support" className="font-semibold text-primary hover:underline">
              Open the support view
            </Link>
          </p>
          {session.mode === 'break_glass' && (
            <div className="space-y-2">
              {reasonField('Need more time? Say why (you can renew once)')}
              <Button variant="secondaryStrong" type="button" disabled={!reasonOk || !!busy} onClick={() => run('renew', { reason: reason.trim() })}>
                {busy === 'renew' ? 'Renewing…' : 'Renew for 30 minutes'}
              </Button>
            </div>
          )}
          <Button variant="primaryStrong" type="button" disabled={!!busy} onClick={() => run('end')}>
            {busy === 'end' ? 'Ending…' : 'End session'}
          </Button>
        </div>
      ) : (
        !session && (
          <div className="space-y-3">
            {reasonField('Why do you need access?')}
            <Field label="Minutes (read-only sessions, up to 60)">
              <Input type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-24" />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="primaryStrong"
                type="button"
                disabled={!reasonOk || !!busy}
                onClick={() => run('read', { tenantId, reason: reason.trim(), minutes: Number(minutes) })}
              >
                {busy === 'read' ? 'Opening…' : 'Open read-only session'}
              </Button>
              <Button variant="secondaryStrong" type="button" disabled={!reasonOk || !!busy} onClick={() => run('request', { tenantId, reason: reason.trim() })}>
                {busy === 'request' ? 'Sending…' : 'Ask to make changes'}
              </Button>
              {approved && (
                <Button variant="secondaryStrong" type="button" disabled={!reasonOk || !!busy} onClick={() => run('open', { consentId: approved.id, reason: reason.trim() })}>
                  {busy === 'open' ? 'Opening…' : 'Open break-glass (30 minutes)'}
                </Button>
              )}
            </div>
          </div>
        )
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-enviro-green-text">
          {notice}
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-ink">Your requests to make changes</h3>
        {readFailed ? (
          <p className="mt-1 text-sm text-danger">Your requests couldn’t be loaded.</p>
        ) : consents.length === 0 ? (
          <p className="mt-1 text-sm text-content-muted">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {consents.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-content-muted">Asked {time(c.requestedAt)}</span>
                <span className={c.status === 'approved' ? 'font-semibold text-enviro-green-text' : 'text-ink'}>{CONSENT_STATUS_LABELS[c.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
