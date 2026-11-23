'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'

/** Ends the viewer's support session (DELETE /api/admin/support/session) and reloads the page. */
export function SupportSessionEndButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function end() {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/admin/support/session', { method: 'DELETE' })
      if (!res.ok) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      router.refresh()
    }
  }

  return (
    <span className="flex items-center gap-2">
      {failed && <span className="text-xs text-ink">Couldn’t end it cleanly. It still ends on time.</span>}
      <Button variant="energy" type="button" onClick={end} disabled={busy} className="px-4 py-2">
        {busy ? 'Ending…' : 'End session'}
      </Button>
    </span>
  )
}
