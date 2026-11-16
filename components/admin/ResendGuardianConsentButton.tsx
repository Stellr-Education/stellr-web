'use client'

import { useState } from 'react'

// S5 wave 8 CONSENT (c), tracker T-23: on the admin roster, beside "Waiting for
// guardian consent", staff resend the guardian's consent form for another
// organiser's event. The form goes to the guardian saved on it; nothing is typed
// here. If the form never went it is sent now; if it went, the guardian is reminded
// on the same form. The server says which, or why it could not.

const OUTCOME_TEXT: Record<string, string> = {
  sent: 'Consent form sent to the guardian.',
  deferred: "Consent form queued. It goes to the guardian once today's sending allowance frees up.",
  reminded: 'Reminder sent to the guardian.',
}

const REMINDER_QUEUED = "Reminder queued. It goes to the guardian once today's sending allowance frees up."


export function ResendGuardianConsentButton({
  eventSlug,
  participantId,
  className,
}: {
  eventSlug: string
  participantId: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function resend() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventSlug)}/participants/${encodeURIComponent(participantId)}/guardian-consent/resend`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { outcome?: string; reminder?: boolean; error?: string } | null
      if (!res.ok) setResult({ ok: false, text: data?.error ?? 'The consent form could not be resent.' })
      else if (data?.outcome === 'deferred' && data.reminder) setResult({ ok: true, text: REMINDER_QUEUED })
      else setResult({ ok: true, text: OUTCOME_TEXT[data?.outcome ?? ''] ?? 'Done.' })
    } catch {
      setResult({ ok: false, text: 'The consent form could not be resent.' })
    }
    setBusy(false)
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Resend consent form'}
      </button>
      {result && <span role="status" className={`text-xs ${result.ok ? 'text-ink' : 'text-danger'}`}>{result.text}</span>}
    </span>
  )
}
