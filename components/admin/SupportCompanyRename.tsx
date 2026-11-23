'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@stellr/web-ui'

/** S6-SUP-UI: rename one company under break-glass (POST /api/admin/platform/support/company-name). */
export function SupportCompanyRename({ eventSlug, companyId, name }: { eventSlug: string; companyId: string; name: string | null }) {
  const router = useRouter()
  const [value, setValue] = useState(name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/platform/support/company-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug, companyId, name: value }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'That didn’t save. Try again.')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input aria-label="Company name" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} className="w-56" />
      <Button variant="secondaryStrong" type="button" className="px-4 py-2" disabled={busy || value === (name ?? '')} onClick={save}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
