'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Badge, Button, Choice, Field, Input, Select } from '@stellr/web-ui'
import { formatAddonPrice } from '@/lib/addons/rules'
import { LINE_STATUS_LABEL } from '@/lib/addons/labels'
import { StepUpDownloadLink } from '@/components/admin/step-up'

interface Line {
  id: string
  addonId: string
  addonTitle: string
  addonKind: string
  participantId: string
  firstName: string
  lastName: string
  group: string | null
  quantity: number
  unitPriceCents: number
  currency: string
  payer: string
  groupMethod: string | null
  status: string
  checkedAt: string | null
}
interface AddonOpt { id: string; title: string; kind: string; status: string; variants?: { variantId: string; label: string }[] }

const LIVE = ['pending_payment', 'pending_consent', 'confirmed']
const payerWords = (l: Line) => (l.payer === 'group' ? (l.groupMethod === 'invoice' ? 'Group invoice' : 'Group card') : l.payer === 'self' ? 'Own link' : l.payer === 'included' ? 'Waived' : 'Paid offline')

/**
 * Staff view of an event's add-on bookings (docs/PLAN-event-add-ons-2026-11-17.md, US-4, US-6,
 * US-7, US-23): who has what, by add-on; waive, mark paid offline, tick off, cancel with or
 * without a refund; each add-on's manifest; booking for someone; cancelling everything if
 * the event is cancelled. Every action is audited; exports are logged.
 */
export function EventAddonBookings({ eventSlug, addons }: { eventSlug: string; addons: AddonOpt[] }) {
  const base = `/api/admin/events/${encodeURIComponent(eventSlug)}/addons/bookings`
  const [lines, setLines] = useState<Line[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Booking for someone
  const [regRef, setRegRef] = useState('')
  const [people, setPeople] = useState<{ id: string; firstName: string; lastName: string }[] | null>(null)
  const [regId, setRegId] = useState<string | null>(null)
  const [bookAddon, setBookAddon] = useState('')
  const [bookVariant, setBookVariant] = useState('')
  const [bookPeople, setBookPeople] = useState<string[]>([])
  const [bookPayer, setBookPayer] = useState<'included' | 'offline' | 'self' | 'group-invoice'>('included')
  const [override, setOverride] = useState(false)

  const load = async () => {
    const res = await fetch(base)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setMessage(json.error ?? 'Could not load bookings')
    setLines(json.lines ?? [])
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- load once for this event

  const byAddon = useMemo(() => {
    const m = new Map<string, Line[]>()
    for (const l of lines ?? []) {
      if (!showAll && !LIVE.includes(l.status)) continue
      m.set(l.addonId, [...(m.get(l.addonId) ?? []), l])
    }
    return m
  }, [lines, showAll])

  const act = async (method: 'PATCH' | 'DELETE', body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setMessage(null)
    const res = await fetch(base, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMessage(json.error ?? 'That didn’t work')
    const manual = (json.cancelled ?? []).filter((c: { outcome: string }) => c.outcome === 'manual_required').length
    setMessage(manual ? `${done} ${manual} need a refund by hand (see the error digest).` : done)
    setSelected(new Set())
    load()
  }
  const ids = [...selected]

  const findRegistration = async () => {
    setMessage(null)
    const res = await fetch(`${base}?registrationId=${encodeURIComponent(regRef.trim())}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setMessage(json.error ?? 'Registration not found')
    setRegId(json.registration.id)
    setPeople(json.participants)
    setBookPeople([])
  }
  const book = async () => {
    if (!regId || !bookAddon || bookPeople.length === 0) return
    setBusy(true)
    setMessage(null)
    const addon = addons.find((a) => a.id === bookAddon)
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationId: regId,
        items: [{ addonId: bookAddon, participantIds: bookPeople, variantId: addon?.kind === 'merch' ? bookVariant || addon.variants?.[0]?.variantId : null }],
        payer: bookPayer === 'group-invoice' ? 'group' : bookPayer,
        groupMethod: bookPayer === 'group-invoice' ? 'invoice' : null,
        overrideMinorRule: override,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMessage(json.error ?? 'Could not book')
    setMessage(`Booked ${json.booked}.${json.linksSent?.length ? ` Pay links emailed to ${json.linksSent.join(', ')}.` : ''}`)
    setBookPeople([])
    load()
  }

  if (!lines) return <Loader2 className="h-4 w-4 animate-spin text-content-muted" aria-label="Loading bookings" />
  const chosenAddon = addons.find((a) => a.id === bookAddon)

  return (
    <div className="space-y-5">
      {message && <p role="status" className="rounded-control border border-line bg-surface px-3 py-2 text-sm text-content-body">{message}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Choice checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} label="Show cancelled, refunded and released" />
        <span className="text-sm text-content-muted">{ids.length} selected</span>
        <Button variant="softBlue" disabled={busy || !ids.length} onClick={() => act('PATCH', { lineIds: ids, action: 'check_in' }, 'Ticked off.')}>Tick off</Button>
        <Button variant="softBlue" disabled={busy || !ids.length} onClick={() => act('PATCH', { lineIds: ids, action: 'mark_paid_offline' }, 'Marked paid offline.')}>Mark paid offline</Button>
        <Button variant="softBlue" disabled={busy || !ids.length} onClick={() => act('PATCH', { lineIds: ids, action: 'waive' }, 'Waived.')}>Waive</Button>
        <Button
          variant="secondary"
          disabled={busy || !ids.length}
          onClick={() => confirm(`Cancel ${ids.length} booking(s)? Paid ones are refunded to whoever paid, if still within their refund date.`) && act('DELETE', { lineIds: ids, refund: true }, 'Cancelled.')}
        >
          Cancel and refund
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !ids.length}
          onClick={() => confirm(`Cancel ${ids.length} booking(s) with no refund?`) && act('DELETE', { lineIds: ids, refund: false }, 'Cancelled without a refund.')}
        >
          Cancel, no refund
        </Button>
      </div>

      {byAddon.size === 0 && <p className="text-sm text-content-muted">No bookings yet.</p>}
      {[...byAddon.entries()].map(([addonId, ls]) => {
        const live = ls.filter((l) => LIVE.includes(l.status))
        const paidCents = live.filter((l) => l.status !== 'pending_payment').reduce((n, l) => n + l.unitPriceCents * l.quantity, 0)
        const owedCents = live.filter((l) => l.status === 'pending_payment').reduce((n, l) => n + l.unitPriceCents * l.quantity, 0)
        return (
          <section key={addonId} className="rounded-ds-card border border-line bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <p className="font-semibold text-ink">{ls[0].addonTitle}</p>
                <p className="text-xs text-content-muted">
                  {live.length} booked · {formatAddonPrice(paidCents, ls[0].currency)} settled · {formatAddonPrice(owedCents, ls[0].currency)} unpaid
                </p>
              </div>
              <StepUpDownloadLink href={`${base}?format=csv&addonId=${addonId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-deep hover:underline">
                <Download className="h-4 w-4" aria-hidden /> Export list
              </StepUpDownloadLink>
            </header>
            <ul className="divide-y divide-line">
              {ls.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Select ${l.firstName} ${l.lastName}`}
                    className="h-5 w-5 accent-primary-deep"
                    checked={selected.has(l.id)}
                    disabled={!LIVE.includes(l.status)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.currentTarget.checked) next.add(l.id)
                      else next.delete(l.id)
                      setSelected(next)
                    }}
                  />
                  <span className="min-w-40 flex-1 text-ink">
                    {l.firstName} {l.lastName}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ''}
                    {l.group && <span className="text-content-muted"> · {l.group}</span>}
                  </span>
                  <span className="text-content-muted">{payerWords(l)}</span>
                  <Badge className={l.status === 'confirmed' ? 'bg-primary-soft text-primary-deep' : 'bg-surface text-content-body'}>{LINE_STATUS_LABEL[l.status] ?? l.status}</Badge>
                  {l.checkedAt && <span className="text-xs text-content-muted">✓ ticked off</span>}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <div className="space-y-3 rounded-ds-card border border-line bg-surface p-4">
        <p className="font-semibold text-ink">Book for someone</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Registration reference" hint="The Reference ID from their confirmation, or the roster.">
            <Input value={regRef} onChange={(e) => setRegRef(e.target.value)} />
          </Field>
          <Button variant="softBlue" onClick={findRegistration} disabled={!regRef.trim()}>Find</Button>
        </div>
        {people && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Extra">
                <Select value={bookAddon} onChange={(e) => { setBookAddon(e.target.value); setBookVariant('') }}>
                  <option value="">Choose…</option>
                  {addons.filter((a) => a.status !== 'archived').map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                </Select>
              </Field>
              {chosenAddon?.kind === 'merch' && (
                <Field label="Size">
                  <Select value={bookVariant} onChange={(e) => setBookVariant(e.target.value)}>
                    {(chosenAddon.variants ?? []).map((v) => <option key={v.variantId} value={v.variantId}>{v.label}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Who pays">
                <Select value={bookPayer} onChange={(e) => setBookPayer(e.target.value as typeof bookPayer)}>
                  <option value="included">Waived (nothing to pay)</option>
                  <option value="offline">Paid offline</option>
                  <option value="self">Each person pays by link</option>
                  <option value="group-invoice">On the group’s invoice</option>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-4">
              {people.map((p) => (
                <Choice
                  key={p.id}
                  checked={bookPeople.includes(p.id)}
                  onChange={(e) => setBookPeople(e.currentTarget.checked ? [...bookPeople, p.id] : bookPeople.filter((x) => x !== p.id))}
                  label={`${p.firstName} ${p.lastName}`}
                />
              ))}
            </div>
            <Choice checked={override} onChange={(e) => setOverride(e.currentTarget.checked)} label="Allow a minor on an individual registration (recorded)" />
            <Button onClick={book} disabled={busy || !bookAddon || bookPeople.length === 0}>Book</Button>
          </div>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => confirm('The event is cancelled: cancel every add-on booking and refund everything paid? This cannot be undone.') && act('DELETE', { cancelAll: true }, 'Every add-on booking cancelled and refunded.')}
        >
          Event cancelled: cancel and refund all add-ons
        </Button>
      </div>
    </div>
  )
}
