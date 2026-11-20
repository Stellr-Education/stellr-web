'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge, Button, Choice, Fieldset, Select } from '@stellr/web-ui'
import Link from '@/components/ui/SiteLink'
import { formatAddonPrice } from '@/lib/addons/rules'
import { LINE_STATUS_LABEL, PAYER_LABEL } from '@/lib/addons/labels'
import { KIND_LABEL, type AddonKind, type AddonVariant } from '@/lib/addons/types'

interface Person { id: string; firstName: string; lastName: string; adult: boolean; minor: boolean }
interface Addon {
  id: string; kind: AddonKind; title: string; description: string; includes: string[]; serviceDate: string | null
  priceCents: number | null; currency: string; audience: 'students' | 'adults' | 'all'; minorsGroupOnly: boolean
  requiresAddendum: boolean; maxPerPerson: number; saleClosesAt: string | null; status: string; variants: AddonVariant[]
}
interface Line { id: string; participantId: string; addonId: string; variantId: string | null; quantity: number; unitPriceCents: number; currency: string; payer: string; status: string; live: boolean }
interface Data {
  registration: { id: string; type: string; status: string; eventSlug: string; eventTitle: string | null }
  actor: { kind: 'organiser'; role: string } | { kind: 'member'; participantId: string }
  participants: Person[]
  addons: Addon[]
  lines: Line[]
}
interface Choice2 { people: string[]; variantId: string; quantity: number }

const MINOR_RULE = (title: string) =>
  `${title} is only available to students under 18 who are travelling with a school or group. An overnight stay needs a responsible adult from the student’s own group. To book it, join or register with a school or group for this event, or contact Stellr and we’ll help arrange it.`

/**
 * Add extras to a registration (US-9 to US-17a). Organisers tick people per extra and
 * choose who pays; a member books for themselves. Refusals from the server are shown
 * in full; the under-18 accommodation rule (FR-5a) is shown beside the option before
 * anyone tries.
 */
export function AddExtras({ registrationId, paid, cancelled }: { registrationId: string; paid?: boolean; cancelled?: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice2>>({})
  const [payer, setPayer] = useState<'group' | 'self'>('self')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(paid ? 'Payment received. Your extras are booked; a receipt is on its way.' : cancelled ? 'Nothing was charged. Your extras are still held until their cut-off.' : null)

  const load = async () => {
    const res = await fetch(`/api/members/addons/${registrationId}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setLoadError(json.error ?? 'Could not load your registration.')
    setData(json)
    if (json.actor?.kind === 'organiser') setPayer('group')
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- load once for this registration

  const organiser = data?.actor.kind === 'organiser'
  const isGroup = data?.registration.type === 'group'
  const people = data?.participants ?? []
  const nameOf = (id: string) => people.find((p) => p.id === id)?.firstName ?? ''
  const addonOf = (id: string) => data?.addons.find((a) => a.id === id)

  const blockedFor = (a: Addon, p: Person): string | null => {
    if (a.audience === 'students' && p.adult) return 'Students only'
    if (a.audience === 'adults' && !p.adult) return 'Adults only'
    if (a.minorsGroupOnly && p.minor && !isGroup) return MINOR_RULE(a.title)
    if (a.kind !== 'merch' && data?.lines.some((l) => l.live && l.addonId === a.id && l.participantId === p.id)) return 'Already booked'
    return null
  }

  const total = useMemo(() => {
    if (!data) return 0
    let n = 0
    for (const [addonId, c] of Object.entries(choices)) {
      const a = data.addons.find((x) => x.id === addonId)
      if (!a) continue
      const unit = a.kind === 'merch' ? (a.variants.find((v) => v.variantId === c.variantId)?.unitCents ?? 0) : (a.priceCents ?? 0)
      n += unit * c.quantity * c.people.length
    }
    return n
  }, [choices, data])

  if (loadError) return <p role="alert" className="text-danger">{loadError}</p>
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-content-muted" aria-label="Loading" />

  const currency = data.addons[0]?.currency ?? 'usd'
  const bookable = data.addons.filter((a) => a.status === 'on_sale')
  const toggle = (addonId: string, pid: string, on: boolean) =>
    setChoices((c) => {
      const cur = c[addonId] ?? { people: [], variantId: addonOf(addonId)?.variants[0]?.variantId ?? '', quantity: 1 }
      const people = on ? [...new Set([...cur.people, pid])] : cur.people.filter((x) => x !== pid)
      const next = { ...c, [addonId]: { ...cur, people } }
      if (people.length === 0) delete next[addonId]
      return next
    })

  const submit = async () => {
    setBusy(true)
    setErrors([])
    setNotice(null)
    const items = Object.entries(choices).map(([addonId, c]) => ({
      addonId,
      participantIds: c.people,
      variantId: addonOf(addonId)?.kind === 'merch' ? c.variantId : null,
      quantity: c.quantity,
    }))
    const res = await fetch(`/api/members/addons/${registrationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, payer, groupMethod: payer === 'group' ? 'card' : null }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      const msgs: string[] = (json.refusals ?? []).map((r: { message: string }) => r.message)
      return setErrors(msgs.length ? [...new Set(msgs)] : [json.error ?? 'Those extras couldn’t be booked.'])
    }
    if (json.checkoutUrl) {
      window.location.href = json.checkoutUrl
      return
    }
    setChoices({})
    setNotice(
      json.linksSent?.length
        ? `Booked. We’ve emailed a pay link to ${json.linksSent.join(', ')}. Each place is held until the extra’s cut-off.`
        : 'Booked.',
    )
    load()
  }

  const myLines = data.lines.filter((l) => l.status !== 'cancelled')
  const forSelf = !organiser && data.actor.kind === 'member' ? data.actor.participantId : null

  return (
    <div className="space-y-8">
      <header>
        <p className="font-subheading text-xs font-semibold uppercase tracking-wide text-primary">Add extras</p>
        <h1 className="font-display text-3xl font-bold text-ink">{data.registration.eventTitle ?? 'Your event'}</h1>
        <p className="mt-2 text-content-body">
          {organiser
            ? 'Choose extras for your group, who each one is for, and who pays.'
            : isGroup
              ? 'Your group’s organizer chooses accommodation and tours. You can order event merch for yourself here.'
              : 'Add extras to your place, up to each one’s cut-off.'}
        </p>
      </header>

      {notice && <p role="status" className="rounded-control border border-line bg-white px-4 py-3 text-sm text-content-body">{notice}</p>}

      {myLines.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-xl font-bold text-ink">Booked</h2>
          <ul className="divide-y divide-line rounded-ds-card border border-line bg-white">
            {myLines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-content-body">
                  {addonOf(l.addonId)?.title ?? 'Extra'}
                  {l.quantity > 1 ? ` × ${l.quantity}` : ''}
                  {organiser ? <span className="text-content-muted"> for {nameOf(l.participantId)}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-content-muted">{PAYER_LABEL[l.payer] ?? ''}</span>
                  <Badge className={l.status === 'confirmed' ? 'bg-primary-soft text-primary-deep' : 'bg-surface text-content-body'}>
                    {LINE_STATUS_LABEL[l.status] ?? l.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.registration.status === 'withdrawn' ? (
        <p className="text-content-body">This registration has been withdrawn, so extras can’t be added.</p>
      ) : bookable.length === 0 ? (
        <p className="text-content-body">There are no extras on sale for this event right now.</p>
      ) : (
        <section className="space-y-4">
          <h2 className="font-heading text-xl font-bold text-ink">Available extras</h2>
          {bookable.map((a) => {
            const memberCantChoose = !organiser && isGroup && a.kind !== 'merch'
            const c = choices[a.id]
            const unit = a.kind === 'merch' ? (a.variants.find((v) => v.variantId === (c?.variantId ?? a.variants[0]?.variantId))?.unitCents ?? 0) : (a.priceCents ?? 0)
            const candidates = forSelf ? people.filter((p) => p.id === forSelf) : people
            return (
              <article key={a.id} className="rounded-ds-card border border-line bg-white p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-subheading text-xs font-semibold uppercase tracking-wide text-primary">{KIND_LABEL[a.kind]}</p>
                    <h3 className="font-heading text-lg font-bold text-ink">{a.title}</h3>
                  </div>
                  <p className="font-heading text-lg font-bold text-ink">{formatAddonPrice(unit, a.currency)}{a.kind !== 'merch' && unit > 0 ? ' per person' : ''}</p>
                </div>
                {a.description && <p className="mt-1 text-sm text-content-body">{a.description}</p>}
                {a.includes.length > 0 && <p className="mt-1 text-sm text-content-muted">Includes {a.includes.join(', ')}.</p>}
                {a.saleClosesAt && (
                  <p className="mt-1 text-xs text-content-muted">Book by {new Date(a.saleClosesAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</p>
                )}
                {memberCantChoose ? (
                  <p className="mt-3 text-sm text-content-body">Your group’s organizer chooses this for the group. Ask them if you’d like it.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {a.kind === 'merch' && (
                      <div className="flex flex-wrap gap-3">
                        <label className="text-sm text-content-body">
                          Size{' '}
                          <Select
                            className="ml-1 inline-block w-auto"
                            value={c?.variantId ?? a.variants[0]?.variantId ?? ''}
                            onChange={(e) => setChoices((x) => ({ ...x, [a.id]: { ...(x[a.id] ?? { people: [], quantity: 1 }), variantId: e.target.value } }))}
                          >
                            {a.variants.map((v) => (
                              <option key={v.variantId} value={v.variantId}>{v.label} ({formatAddonPrice(v.unitCents, a.currency)})</option>
                            ))}
                          </Select>
                        </label>
                        <label className="text-sm text-content-body">
                          Quantity each{' '}
                          <Select
                            className="ml-1 inline-block w-auto"
                            value={String(c?.quantity ?? 1)}
                            onChange={(e) => setChoices((x) => ({ ...x, [a.id]: { ...(x[a.id] ?? { people: [], variantId: a.variants[0]?.variantId ?? '' }), quantity: Number(e.target.value) } }))}
                          >
                            {Array.from({ length: a.maxPerPerson }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </Select>
                        </label>
                      </div>
                    )}
                    <Fieldset legend={organiser ? 'Who is it for?' : 'Add it'}>
                      {candidates.map((p) => {
                        const blocked = blockedFor(a, p)
                        return (
                          <div key={p.id}>
                            <Choice
                              checked={!!c?.people.includes(p.id)}
                              disabled={!!blocked}
                              onChange={(e) => toggle(a.id, p.id, e.currentTarget.checked)}
                              label={organiser ? `${p.firstName} ${p.lastName}` : `Add ${a.title}`}
                            />
                            {blocked && <p className="mb-2 ml-8 text-xs text-content-muted">{blocked}</p>}
                          </div>
                        )
                      })}
                    </Fieldset>
                    {a.requiresAddendum && people.some((p) => p.minor) && (
                      <p className="text-xs text-content-muted">Under-18s need a parent or guardian to sign the overnight and off-site consent before this is confirmed.</p>
                    )}
                  </div>
                )}
              </article>
            )
          })}

          {Object.keys(choices).length > 0 && (
            <div className="space-y-4 rounded-ds-card border border-line bg-surface p-5">
              {organiser && (
                <Fieldset legend="Who pays?">
                  <Choice type="radio" name="payer" checked={payer === 'group'} onChange={() => setPayer('group')} label="I pay now by card, for everyone chosen" />
                  <Choice type="radio" name="payer" checked={payer === 'self'} onChange={() => setPayer('self')} label="Each person pays: we email them a link to pay for their own" />
                </Fieldset>
              )}
              <p className="font-semibold text-ink">Total {formatAddonPrice(total, currency)}</p>
              {errors.length > 0 && (
                <div role="alert" className="space-y-1 rounded-control border border-danger/30 bg-white px-4 py-3 text-sm text-danger">
                  {errors.map((m) => <p key={m}>{m}</p>)}
                </div>
              )}
              <Button onClick={submit} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {payer === 'group' || !organiser ? (total > 0 ? 'Continue to payment' : 'Book') : 'Book and send pay links'}
              </Button>
            </div>
          )}
        </section>
      )}

      <p className="text-sm">
        <Link href="/account" className="font-medium text-primary-deep hover:underline">Back to your account</Link>
      </p>
    </div>
  )
}
