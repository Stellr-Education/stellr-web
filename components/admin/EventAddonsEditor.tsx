'use client'

import { useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Choice, Field, Input, Select, Textarea, Badge } from '@stellr/web-ui'
import { formatAddonPrice } from '@/lib/addons/rules'
import { KIND_LABEL, type AddonKind, type AddonRow, type AddonSettings } from '@/lib/addons/types'

interface AdminAddon extends AddonRow {
  taken: number
  variantIds: string[]
}
interface ProductOpt {
  id: string
  name: string
  variants: { id: string; label: string | null; active: boolean }[]
}

type Draft = {
  id?: string
  kind: AddonKind
  title: string
  description: string
  includes: string
  serviceDate: string
  serviceEndDate: string
  price: string
  capacity: string
  saleOpensAt: string
  saleClosesAt: string
  audience: 'students' | 'adults' | 'all'
  refundRule: 'until_cutoff' | 'event_policy' | 'none'
  refundUntil: string
  requiresAddendum: boolean
  minorsGroupOnly: boolean
  maxPerPerson: string
  storeProductId: string
  variantIds: string[]
  displayGroup: string
  sort: string
  status: 'draft' | 'on_sale' | 'closed' | 'archived'
}

const EMPTY: Draft = {
  kind: 'accommodation',
  title: '',
  description: '',
  includes: '',
  serviceDate: '',
  serviceEndDate: '',
  price: '',
  capacity: '',
  saleOpensAt: '',
  saleClosesAt: '',
  audience: 'all',
  refundRule: 'until_cutoff',
  refundUntil: '',
  requiresAddendum: false,
  minorsGroupOnly: true,
  maxPerPerson: '10',
  storeProductId: '',
  variantIds: [],
  displayGroup: '',
  sort: '0',
  status: 'draft',
}

const STATUS_LABEL: Record<Draft['status'], string> = { draft: 'Draft', on_sale: 'On sale', closed: 'Closed', archived: 'Archived' }

// datetime-local <-> ISO, in the browser's time zone.
const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null)

function draftFrom(a: AdminAddon): Draft {
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    description: a.description,
    includes: (a.includes ?? []).join('\n'),
    serviceDate: a.service_date ?? '',
    serviceEndDate: a.service_end_date ?? '',
    price: a.price_cents == null ? '' : (a.price_cents / 100).toFixed(2),
    capacity: a.capacity == null ? '' : String(a.capacity),
    saleOpensAt: toLocal(a.sale_opens_at),
    saleClosesAt: toLocal(a.sale_closes_at),
    audience: a.audience,
    refundRule: a.refund_rule,
    refundUntil: toLocal(a.refund_until),
    requiresAddendum: a.requires_addendum,
    minorsGroupOnly: a.minors_group_only,
    maxPerPerson: String(a.max_per_person),
    storeProductId: a.store_product_id ?? '',
    variantIds: a.variantIds,
    displayGroup: a.display_group ?? '',
    sort: String(a.sort),
    status: a.status,
  }
}

function payloadFrom(d: Draft) {
  return {
    kind: d.kind,
    title: d.title,
    description: d.description,
    includes: d.includes.split('\n').map((s) => s.trim()).filter(Boolean),
    serviceDate: d.serviceDate || null,
    serviceEndDate: d.serviceEndDate || null,
    priceCents: d.kind === 'merch' || d.price === '' ? null : Math.round(Number(d.price) * 100),
    capacity: d.kind === 'merch' || d.capacity === '' ? null : Number(d.capacity),
    saleOpensAt: fromLocal(d.saleOpensAt),
    saleClosesAt: fromLocal(d.saleClosesAt),
    audience: d.audience,
    refundRule: d.refundRule,
    refundUntil: fromLocal(d.refundUntil),
    requiresAddendum: d.requiresAddendum,
    minorsGroupOnly: d.minorsGroupOnly,
    maxPerPerson: d.kind === 'merch' ? Number(d.maxPerPerson || 10) : 1,
    storeProductId: d.kind === 'merch' ? d.storeProductId || null : null,
    variantIds: d.kind === 'merch' ? d.variantIds : [],
    displayGroup: d.displayGroup || null,
    sort: Number(d.sort || 0),
    status: d.status,
  }
}

/**
 * An event's add-ons: accommodation (one per night), experiences and merch
 * (docs/PLAN-event-add-ons-2026-11-17.md), plus the merch upsell and what the
 * place includes. Prices snapshot onto each booking, so editing one affects
 * later bookings only.
 */
export function EventAddonsEditor({ eventSlug }: { eventSlug: string }) {
  const [addons, setAddons] = useState<AdminAddon[]>([])
  const [products, setProducts] = useState<ProductOpt[]>([])
  const [settings, setSettings] = useState<AddonSettings>({ merchUpsell: true, inclusions: [] })
  const [inclusionsText, setInclusionsText] = useState('')
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/admin/events/${encodeURIComponent(eventSlug)}/addons`

  const load = async () => {
    const res = await fetch(base)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setError(json.error ?? 'Could not load add-ons')
    setAddons(json.addons ?? [])
    setProducts(json.products ?? [])
    if (json.settings) {
      setSettings(json.settings)
      setInclusionsText((json.settings.inclusions ?? []).join('\n'))
    }
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- fetch once on mount; load() only reads the eventSlug prop

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    const res = await fetch(draft.id ? `${base}/${draft.id}` : base, {
      method: draft.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadFrom(draft)),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(json.error ?? 'Could not save the add-on')
    setDraft(null)
    setNotice('Add-on saved.')
    load()
  }

  const remove = async (a: AdminAddon) => {
    const verb = a.taken > 0 ? 'Archive' : 'Delete'
    if (!confirm(`${verb} "${a.title}"?${a.taken > 0 ? ' It has bookings, so it will be hidden from sale and the bookings kept.' : ''}`)) return
    const res = await fetch(`${base}/${a.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return setError(json.error ?? 'Could not remove the add-on')
    setNotice(json.archived ? 'Archived: hidden from sale, bookings kept.' : 'Deleted.')
    load()
  }

  const saveSettings = async (next: AddonSettings) => {
    setBusy(true)
    setError(null)
    const res = await fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
    setBusy(false)
    if (!res.ok) return setError('Could not save the settings')
    setSettings(next)
    setNotice('Settings saved.')
  }

  const product = products.find((p) => p.id === draft?.storeProductId)

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && !error && <p role="status" className="text-sm text-content-muted">{notice}</p>}

      <div className="space-y-3 rounded-ds-card border border-line bg-white p-4">
        <Choice
          checked={settings.merchUpsell}
          disabled={busy}
          onChange={(e) => saveSettings({ ...settings, merchUpsell: e.currentTarget.checked })}
          label="Promote event merch (on the event page, in registration and on the confirmation page)"
        />
        <Field label="What the place includes" hint="One per line. Shown under “What’s included” on the event page, for example “Saturday night’s accommodation”.">
          <Textarea rows={3} value={inclusionsText} onChange={(e) => setInclusionsText(e.target.value)} />
        </Field>
        <Button
          variant="softBlue"
          disabled={busy}
          onClick={() => saveSettings({ ...settings, inclusions: inclusionsText.split('\n').map((s) => s.trim()).filter(Boolean) })}
        >
          Save what’s included
        </Button>
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-content-muted" aria-label="Loading" />
      ) : (
        <ul className="space-y-2">
          {addons.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line px-3 py-2 text-sm">
              <div className="min-w-0">
                <Badge className="mr-2 bg-primary-soft text-primary">{KIND_LABEL[a.kind]}</Badge>
                <span className="font-medium text-ink">{a.title}</span>
                <span className="text-content-muted">
                  {' · '}
                  {a.kind === 'merch' ? `${a.variantIds.length} size${a.variantIds.length === 1 ? '' : 's'}` : formatAddonPrice(a.price_cents ?? 0, a.currency)}
                  {' · '}
                  {a.taken} booked{a.capacity != null ? ` of ${a.capacity}` : ''}
                  {' · '}
                  {STATUS_LABEL[a.status]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setDraft(draftFrom(a))} className="text-content-muted hover:text-ink" aria-label={`Edit ${a.title}`}>
                  <Pencil className="h-4 w-4" />
                </button>
                {a.status !== 'archived' && (
                  <button type="button" onClick={() => remove(a)} className="text-content-muted hover:text-danger" aria-label={`Remove ${a.title}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
          {addons.length === 0 && <li className="text-sm text-content-muted">No add-ons for this event yet.</li>}
        </ul>
      )}

      {!draft && (
        <Button variant="secondary" onClick={() => { setNotice(null); setDraft({ ...EMPTY }) }}>
          <Plus className="h-4 w-4" /> New add-on
        </Button>
      )}

      {draft && (
        <div className="space-y-4 rounded-ds-card border border-line bg-surface p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind" required>
              <Select
                value={draft.kind}
                disabled={!!draft.id}
                onChange={(e) => {
                  const kind = e.target.value as AddonKind
                  setDraft((d) => (d ? { ...d, kind, minorsGroupOnly: kind === 'accommodation' } : d))
                }}
              >
                <option value="accommodation">Accommodation (one night)</option>
                <option value="experience">Experience (tour, visit)</option>
                <option value="merch">Event merch</option>
              </Select>
            </Field>
            <Field label="Title" required hint={draft.kind === 'accommodation' ? 'For example “Friday night, 5 March”' : undefined}>
              <Input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={200} />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} />
            </Field>

            {draft.kind === 'merch' ? (
              <>
                <Field label="Store product" required>
                  <Select value={draft.storeProductId} onChange={(e) => setDraft((d) => (d ? { ...d, storeProductId: e.target.value, variantIds: [] } : d))}>
                    <option value="">Choose…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Most of one size per order" hint="Catches typing mistakes. Staff can book more.">
                  <Input type="number" min={1} max={100} value={draft.maxPerPerson} onChange={(e) => set('maxPerPerson', e.target.value)} />
                </Field>
                {product && (
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-1 text-sm font-medium text-content-body">Sizes on sale</legend>
                    <div className="flex flex-wrap gap-x-4">
                      {product.variants.filter((v) => v.active).map((v) => (
                        <Choice
                          key={v.id}
                          checked={draft.variantIds.includes(v.id)}
                          onChange={(e) =>
                            set('variantIds', e.currentTarget.checked ? [...draft.variantIds, v.id] : draft.variantIds.filter((x) => x !== v.id))
                          }
                          label={v.label ?? 'One size'}
                        />
                      ))}
                    </div>
                  </fieldset>
                )}
              </>
            ) : (
              <>
                <Field label="Price per person (USD)" required hint="0 for free.">
                  <Input type="number" min={0} step="0.01" value={draft.price} onChange={(e) => set('price', e.target.value)} />
                </Field>
                <Field label="Places" hint="People, not rooms. Blank for unlimited.">
                  <Input type="number" min={0} value={draft.capacity} onChange={(e) => set('capacity', e.target.value)} />
                </Field>
                <Field label="Date">
                  <Input type="date" value={draft.serviceDate} onChange={(e) => set('serviceDate', e.target.value)} />
                </Field>
                <Field label="End date" hint="Only if it runs over more than one day.">
                  <Input type="date" value={draft.serviceEndDate} onChange={(e) => set('serviceEndDate', e.target.value)} />
                </Field>
                <Field label="What it includes" hint="One per line, for example “Dinner Friday” and “Breakfast Saturday”." className="sm:col-span-2">
                  <Textarea rows={3} value={draft.includes} onChange={(e) => set('includes', e.target.value)} />
                </Field>
                <Field label="Who can take it">
                  <Select value={draft.audience} onChange={(e) => set('audience', e.target.value as Draft['audience'])}>
                    <option value="all">Students and adults</option>
                    <option value="students">Students only</option>
                    <option value="adults">Adults only</option>
                  </Select>
                </Field>
                <Field label="Group on the page under" hint="Optional, for example “Accommodation”.">
                  <Input value={draft.displayGroup} onChange={(e) => set('displayGroup', e.target.value)} maxLength={100} />
                </Field>
              </>
            )}

            <Field label="Sales open">
              <Input type="datetime-local" value={draft.saleOpensAt} onChange={(e) => set('saleOpensAt', e.target.value)} />
            </Field>
            <Field label="Sales close (cut-off)" hint="Unpaid places are released at this time.">
              <Input type="datetime-local" value={draft.saleClosesAt} onChange={(e) => set('saleClosesAt', e.target.value)} />
            </Field>
            <Field label="Refunds">
              <Select value={draft.refundRule} onChange={(e) => set('refundRule', e.target.value as Draft['refundRule'])}>
                <option value="until_cutoff">Full refund until a date, none after</option>
                <option value="event_policy">Follow the event’s refund policy</option>
                <option value="none">Not refundable</option>
              </Select>
            </Field>
            {draft.refundRule === 'until_cutoff' && (
              <Field label="Refunds until" hint={draft.kind === 'merch' ? 'Merch also stops being refundable once the merch order is committed.' : 'Blank: the sales cut-off.'}>
                <Input type="datetime-local" value={draft.refundUntil} onChange={(e) => set('refundUntil', e.target.value)} />
              </Field>
            )}
            {draft.kind !== 'merch' && (
              <div className="sm:col-span-2 space-y-1">
                <Choice
                  checked={draft.minorsGroupOnly}
                  onChange={(e) => set('minorsGroupOnly', e.currentTarget.checked)}
                  label="Under-18s only through a group (not on an individual registration)"
                />
                <Choice
                  checked={draft.requiresAddendum}
                  onChange={(e) => set('requiresAddendum', e.currentTarget.checked)}
                  label="Under-18s need the signed overnight and off-site addendum before it’s confirmed"
                />
              </div>
            )}
            <Field label="Status">
              <Select value={draft.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
                <option value="draft">Draft (hidden)</option>
                <option value="on_sale">On sale</option>
                <option value="closed">Closed (listed, not bookable)</option>
                <option value="archived">Archived (hidden)</option>
              </Select>
            </Field>
            <Field label="Order on the page" hint="Lower comes first.">
              <Input type="number" value={draft.sort} onChange={(e) => set('sort', e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save add-on
            </Button>
            <Button variant="secondary" onClick={() => { setDraft(null); setError(null) }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
