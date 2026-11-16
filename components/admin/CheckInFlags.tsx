'use client'

import { Hourglass } from 'lucide-react'
import { Badge, cn } from '@stellr/web-ui'
import { hasFlags, type DeskFlags } from '@/lib/check-in-desk'
import { CONSENT_PENDING_MARKER } from '@/lib/check-in-consent'

// What staff should know when someone arrives: an unsigned agreement, money
// owed, a medical or dietary note. Flags only, never a block (David, 30 Oct
// 2026): the desk checks the student in and follows up. Tap to read the detail.

const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold'

export function flagChips(f: DeskFlags): { key: string; label: string; className: string }[] {
  const chips: { key: string; label: string; className: string }[] = []
  if (f.agreement) chips.push({ key: 'agreement', label: 'Form not signed', className: 'bg-pathway-amber-bg text-gold-ink' })
  if (f.unpaid) chips.push({ key: 'unpaid', label: 'Unpaid', className: 'bg-pathway-amber-bg text-gold-ink' })
  if (f.medical) chips.push({ key: 'medical', label: 'Medical', className: 'bg-danger/10 text-danger' })
  if (f.dietary.length) chips.push({ key: 'dietary', label: 'Dietary', className: 'bg-surface text-content-body ring-1 ring-line' })
  return chips
}

export default function CheckInFlags({ flags, className }: { flags: DeskFlags | undefined; className?: string }) {
  if (!flags || !hasFlags(flags)) return null
  return (
    <details className={cn('group mt-1', className)}>
      <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        {flagChips(flags).map((c) => (
          <span key={c.key} className={cn(CHIP, c.className)}>
            {c.label}
          </span>
        ))}
        <span className="text-xs text-content-muted group-open:hidden">Details</span>
        <span className="hidden text-xs text-content-muted group-open:inline">Hide</span>
      </summary>
      <dl className="mt-1 space-y-1 rounded-control bg-surface px-3 py-2 text-sm text-content-body">
        {flags.agreement && (
          <div>
            <dt className="inline font-semibold text-ink">Agreement: </dt>
            <dd className="inline">
              {flags.agreement}
              {flags.agreementDetail && <> · {flags.agreementDetail}</>}
            </dd>
          </div>
        )}
        {flags.unpaid && (
          <div>
            <dt className="inline font-semibold text-ink">Payment: </dt>
            <dd className="inline">{flags.unpaid}</dd>
          </div>
        )}
        {flags.medical && (
          <div>
            <dt className="inline font-semibold text-ink">Medical: </dt>
            <dd className="inline whitespace-pre-line">{flags.medical}</dd>
          </div>
        )}
        {flags.dietary.length > 0 && (
          <div>
            <dt className="inline font-semibold text-ink">Dietary: </dt>
            <dd className="inline">{flags.dietary.join(', ')}</dd>
          </div>
        )}
      </dl>
    </details>
  )
}

/**
 * S5 CONSENT (c), WD-6: a tenant event's participant whose parent or guardian has
 * not signed the consent form. Unlike the flags above this one is a block: the
 * desk cannot check them in until the form is signed. Never shown at a Stellr
 * event, which has no consent rows.
 */
export function ConsentPendingMarker({ className }: { className?: string }) {
  return (
    <Badge className={cn('mt-1 gap-1 bg-danger/10 text-danger', className)}>
      <Hourglass className="h-3.5 w-3.5" aria-hidden />
      {CONSENT_PENDING_MARKER}
    </Badge>
  )
}
