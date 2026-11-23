'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'
import { useStepUpFetch } from '@/components/admin/use-step-up-fetch'

/**
 * S6-CON-b: one per-tenant switch. The API asks for a fresh sign-in factor (Clerk's
 * dialog opens through useStepUpFetch) and records the change on the tenant's audit log.
 */
export function TenantFlagToggle({
  tenantId,
  flag,
  label,
  description,
  enabled,
  isDefault,
}: {
  tenantId: string
  flag: string
  label: string
  description: string
  enabled: boolean
  isDefault: boolean
}) {
  const router = useRouter()
  const stepUpFetch = useStepUpFetch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      const res = await stepUpFetch(`/api/admin/platform/tenants/${tenantId}/flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag, enabled: !enabled }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'That didn’t work. Try again.')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {label}: <span className={enabled ? 'text-enviro-green-text' : 'text-danger'}>{enabled ? 'on' : 'off'}</span>
          {isDefault && <span className="ml-2 text-xs font-normal text-content-muted">(default)</span>}
        </p>
        <p className="mt-0.5 text-sm text-content-muted">{description}</p>
        {error && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <Button variant="secondaryStrong" disabled={busy} onClick={toggle}>
        {enabled ? 'Turn off' : 'Turn on'}
      </Button>
    </div>
  )
}
