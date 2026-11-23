'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ConfirmDialog, Field, Textarea } from '@stellr/web-ui'
import { useStepUpFetch } from '@/components/admin/use-step-up-fetch'

const REASON_MIN = 20

/**
 * S6-CON: suspend or resume a tenant. The API asks for a fresh sign-in factor (Clerk's
 * dialog opens through useStepUpFetch) and records the change on the tenant's audit log.
 */
export function TenantStatusControl({ tenantId, tenantName, status }: { tenantId: string; tenantName: string; status: 'active' | 'suspended' }) {
  const router = useRouter()
  const stepUpFetch = useStepUpFetch()
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const suspending = status === 'active'
  const to = suspending ? 'suspended' : 'active'
  const reasonOk = reason.trim().length >= REASON_MIN

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await stepUpFetch(`/api/admin/platform/tenants/${tenantId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to, reason: reason.trim() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? 'That didn’t work. Try again.')
        return
      }
      setReason('')
      router.refresh()
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field
        label={suspending ? 'Why are you suspending this organization?' : 'Why are you bringing this organization back?'}
        hint={`At least ${REASON_MIN} characters. The audit log records that you did it, not the reason.`}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button variant={suspending ? 'secondaryStrong' : 'primaryStrong'} disabled={!reasonOk || busy} onClick={() => setConfirming(true)}>
        {suspending ? 'Suspend' : 'Resume'}
      </Button>
      <ConfirmDialog
        open={confirming}
        tone={suspending ? 'danger' : 'default'}
        busy={busy}
        title={suspending ? `Suspend ${tenantName}?` : `Resume ${tenantName}?`}
        description={
          suspending
            ? 'Its sites stop answering within about two minutes. No data is deleted, and you can resume it.'
            : 'Its sites start answering again within about two minutes.'
        }
        confirmLabel={suspending ? 'Suspend' : 'Resume'}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
