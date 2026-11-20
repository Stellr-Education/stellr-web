'use client'

import { useState } from 'react'
import { Button } from '@stellr/web-ui'

/** Opens the Stripe Checkout for this pay link. The server fixes the amount. */
export function AddonPayButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pay = async () => {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/register/addons-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.url) {
      window.location.href = json.url
      return
    }
    setBusy(false)
    setError(json.error ?? 'Something went wrong. Please try again.')
  }
  return (
    <div>
      <Button onClick={pay} disabled={busy} className="w-full">
        {busy ? 'Opening secure checkout…' : 'Pay now'}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
