'use client'

import { useId } from 'react'
import { Choice, Fieldset, Select } from '@stellr/web-ui'
import { addonDateLabel, addonFootnote, addonKindLabel, addonPriceLabel } from '@/lib/addons/display'
import { minorIndividualMessage } from '@/lib/addons/labels'
import { formatAddonPrice } from '@/lib/addons/rules'
import type { PublicAddon } from '@/lib/addons/types'

export interface ExtrasPerson {
  /** The email the form entered (a group), or "self" (an individual registrant). */
  key: string
  label: string
  adult: boolean
  minor: boolean
}

export interface ExtrasValue {
  items: { addonId: string; people: string[]; variantId: string | null; quantity: number }[]
  payer: 'group' | 'self'
  groupMethod: 'invoice' | null
}

export const EMPTY_EXTRAS: ExtrasValue = { items: [], payer: 'self', groupMethod: null }

/**
 * The registration forms' Extras step (docs/PLAN-event-add-ons-2026-11-17.md, US-9, US-12):
 * accommodation, experiences and event merch, merch first when the event's upsell is on.
 * The server books them once the place is saved; nothing here prices anything. The
 * under-18 accommodation rule (FR-5a) is shown beside the option, which stays visible.
 */
export function RegistrationExtras({
  addons,
  merchUpsell,
  people,
  mode,
  value,
  onChange,
  isStudentManager = false,
}: {
  addons: PublicAddon[]
  merchUpsell: boolean
  people: ExtrasPerson[]
  mode: 'individual' | 'group'
  value: ExtrasValue
  onChange: (v: ExtrasValue) => void
  isStudentManager?: boolean
}) {
  const idBase = useId()
  const onSale = addons.filter((a) => a.availability !== 'sold_out' || a.kind === 'merch')
  if (onSale.length === 0) return null
  const ordered = merchUpsell
    ? [...onSale.filter((a) => a.kind === 'merch'), ...onSale.filter((a) => a.kind !== 'merch')]
    : [...onSale.filter((a) => a.kind !== 'merch'), ...onSale.filter((a) => a.kind === 'merch')]

  const item = (addonId: string) => value.items.find((i) => i.addonId === addonId)
  const setItem = (addonId: string, next: Partial<ExtrasValue['items'][number]> | null) => {
    const rest = value.items.filter((i) => i.addonId !== addonId)
    if (!next) return onChange({ ...value, items: rest })
    const cur = item(addonId) ?? { addonId, people: [], variantId: null, quantity: 1 }
    const merged = { ...cur, ...next }
    onChange({ ...value, items: merged.people.length ? [...rest, merged] : rest })
  }
  const blockedFor = (a: PublicAddon, p: ExtrasPerson): string | null => {
    if (a.availability === 'sold_out') return 'Sold out'
    if (a.audience === 'students' && p.adult) return 'Students only'
    if (a.audience === 'adults' && !p.adult) return 'Adults only'
    if (a.minorsGroupOnly && p.minor && mode === 'individual') return minorIndividualMessage(a.title)
    return null
  }
  const total = value.items.reduce((n, i) => {
    const a = addons.find((x) => x.id === i.addonId)
    if (!a) return n
    const unit = a.kind === 'merch' ? (a.variants.find((v) => v.variantId === i.variantId)?.unitCents ?? 0) : (a.priceCents ?? 0)
    return n + unit * i.quantity * i.people.length
  }, 0)
  const currency = addons[0]?.currency ?? 'usd'

  return (
    <section className="space-y-4 rounded-ds-card border border-line bg-white p-6" aria-labelledby={`${idBase}-h`}>
      <div>
        <h3 id={`${idBase}-h`} className="font-heading text-lg font-bold text-ink">Extras (optional)</h3>
        <p className="text-sm text-content-body">
          {mode === 'individual'
            ? 'Add them now and pay for them right after your place, or add them later from your account.'
            : 'Choose extras for people on your roster. You can add more later from your account.'}
        </p>
      </div>

      {ordered.map((a) => {
        const it = item(a.id)
        const variant = a.variants.find((v) => v.variantId === (it?.variantId ?? a.variants[0]?.variantId))
        const unit = a.kind === 'merch' ? (variant?.unitCents ?? 0) : (a.priceCents ?? 0)
        const date = addonDateLabel(a)
        const note = addonFootnote(a)
        return (
          <div key={a.id} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-ink">
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-primary">{addonKindLabel(a)}</span>
                {a.title}
              </p>
              <p className="text-sm font-semibold text-ink">{addonPriceLabel({ ...a, priceCents: a.kind === 'merch' ? unit : a.priceCents })}</p>
            </div>
            {(date || a.includes.length > 0) && (
              <p className="text-sm text-content-muted">
                {[date, a.includes.length ? `Includes ${a.includes.join(', ')}` : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {note && mode === 'group' && <p className="text-xs text-content-muted">{note}</p>}

            {a.kind === 'merch' && (
              <div className="mt-2 flex flex-wrap gap-3">
                <label className="text-sm text-content-body">
                  Size{' '}
                  <Select
                    className="ml-1 inline-block w-auto"
                    value={it?.variantId ?? a.variants[0]?.variantId ?? ''}
                    onChange={(e) => (it ? setItem(a.id, { variantId: e.target.value }) : undefined)}
                    disabled={!it}
                  >
                    {a.variants.map((v) => (
                      <option key={v.variantId} value={v.variantId}>{v.label} ({formatAddonPrice(v.unitCents, a.currency)})</option>
                    ))}
                  </Select>
                </label>
                <label className="text-sm text-content-body">
                  Quantity each{' '}
                  <Select className="ml-1 inline-block w-auto" value={String(it?.quantity ?? 1)} onChange={(e) => (it ? setItem(a.id, { quantity: Number(e.target.value) }) : undefined)} disabled={!it}>
                    {Array.from({ length: a.maxPerPerson }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </Select>
                </label>
              </div>
            )}

            <Fieldset legend={mode === 'group' ? `Who is ${a.title} for?` : `Add ${a.title}`} className="mt-2">
              {people.map((p) => {
                const blocked = blockedFor(a, p)
                return (
                  <div key={p.key}>
                    <Choice
                      checked={!!it?.people.includes(p.key)}
                      disabled={!!blocked}
                      onChange={(e) => {
                        const on = e.currentTarget.checked
                        const ppl = on ? [...new Set([...(it?.people ?? []), p.key])] : (it?.people ?? []).filter((k) => k !== p.key)
                        setItem(a.id, { people: ppl, variantId: it?.variantId ?? a.variants[0]?.variantId ?? null })
                      }}
                      label={mode === 'group' ? p.label : `Yes, add ${a.title}`}
                    />
                    {blocked && <p className="mb-2 ml-8 text-xs text-content-muted">{blocked}</p>}
                  </div>
                )
              })}
            </Fieldset>
            {a.requiresAddendum && people.some((p) => p.minor) && (
              <p className="mt-1 text-xs text-content-muted">Under-18s need a parent or guardian to sign the overnight and off-site consent before this is confirmed.</p>
            )}
          </div>
        )
      })}

      {value.items.length > 0 && (
        <div className="space-y-2 border-t border-line pt-4">
          {mode === 'group' && (
            <Fieldset legend="Who pays for the extras?">
              <Choice
                type="radio"
                name={`${idBase}-payer`}
                checked={value.payer === 'group'}
                disabled={isStudentManager}
                onChange={() => onChange({ ...value, payer: 'group', groupMethod: 'invoice' })}
                label="Add them to our school’s invoice"
              />
              {isStudentManager && (
                <p className="ml-8 text-xs text-content-muted">Extras go on your school’s invoice only with your teacher’s agreement.</p>
              )}
              <Choice
                type="radio"
                name={`${idBase}-payer`}
                checked={value.payer === 'self'}
                onChange={() => onChange({ ...value, payer: 'self', groupMethod: null })}
                label="Each person pays: we email them a link to pay for their own"
              />
            </Fieldset>
          )}
          <p className="text-sm font-semibold text-ink">Extras total {formatAddonPrice(total, currency)}</p>
        </div>
      )}
    </section>
  )
}
