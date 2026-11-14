'use client'

import { useState } from 'react'
import { AdminOnlyNote, useCan } from '@/components/admin/CapabilitiesContext'

// Reviewer notes on a scholarship application — internal only, never emailed.
// Saving is a scholarship decision (scholarships:write): Staff read the notes.
export function ScholarshipNotes({ id, initial }: { id: string; initial: string }) {
  const canWrite = useCan('scholarships:write')
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')

  async function save() {
    if (value === saved) return
    setState('saving')
    const res = await fetch(`/api/admin/scholarships/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNotes: value }),
    }).catch(() => null)
    if (res?.ok) {
      setSaved(value)
      setState('idle')
    } else setState('error')
  }

  if (!canWrite) {
    return (
      <div>
        <p className="text-sm text-content-body mb-1">Reviewer notes (internal only)</p>
        {initial ? (
          <p className="whitespace-pre-wrap rounded-lg bg-surface px-4 py-3 text-sm text-ink">{initial}</p>
        ) : (
          <p className="text-sm text-content-muted">No notes yet.</p>
        )}
        <AdminOnlyNote className="mt-1">An admin writes the reviewer notes.</AdminOnlyNote>
      </div>
    )
  }

  return (
    <div>
      <label htmlFor="sch-notes" className="block text-sm text-content-body mb-1">Reviewer notes (internal only)</label>
      <textarea
        id="sch-notes"
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        className="w-full rounded-control border border-line-strong px-3 py-2 text-input mouse:text-sm text-ink"
      />
      <p className="text-xs text-content-body h-4">
        {state === 'saving' ? 'Saving…' : state === 'error' ? 'Couldn’t save — try again.' : value !== saved ? 'Saves when you click away.' : ''}
      </p>
    </div>
  )
}
