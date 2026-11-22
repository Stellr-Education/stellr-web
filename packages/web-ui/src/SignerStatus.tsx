import * as React from 'react'
import { CircleAlert, CircleCheck, CircleDashed, Clock } from 'lucide-react'

/* ── SignerStatusList ───────────────────────────────────────────────────────
 * Where each person on an agreement is up to, one line each: icon, role, status.
 * The compact answer to "who still has to sign?".
 *
 * Status is never carried by colour alone (WCAG 1.4.1): every tone has its own
 * icon shape and a status word. Tones follow the usual traffic-light reading:
 *   done       green  · check      signed
 *   attention  red    · alert      someone has to act (bounced, declined)
 *   waiting    amber  · clock      their turn, not signed yet
 *   queued     grey   · dashed     not their turn yet
 */

export type SignerStatusTone = 'done' | 'attention' | 'waiting' | 'queued'

export interface SignerStatusItem {
  /** Stable key (recipient id, or role + email). */
  id: string
  /** Short role, e.g. "Parent", "Student", "Mentor". */
  role: string
  /** Optional: shown after the role where the surface does not already name the person. */
  name?: string
  tone: SignerStatusTone
  /** Two or three words, e.g. "Signed Nov 17, 2026", "Email bounced". */
  status: string
}

const TONE: Record<SignerStatusTone, { Icon: typeof CircleCheck; icon: string; text: string }> = {
  done:      { Icon: CircleCheck,  icon: 'text-enviro-green', text: 'text-enviro-green-text' },
  attention: { Icon: CircleAlert,  icon: 'text-danger',       text: 'text-danger font-semibold' },
  waiting:   { Icon: Clock,        icon: 'text-gold-ink',     text: 'text-gold-ink' },
  queued:    { Icon: CircleDashed, icon: 'text-content-muted', text: 'text-content-muted' },
}

export function SignerStatusList({
  signers,
  className,
  'aria-label': ariaLabel = 'Signers',
}: {
  signers: SignerStatusItem[]
  className?: string
  'aria-label'?: string
}) {
  if (signers.length === 0) return null
  return (
    <ul aria-label={ariaLabel} className={['space-y-1 text-xs', className].filter(Boolean).join(' ')}>
      {signers.map((s) => {
        const t = TONE[s.tone]
        return (
          <li key={s.id} className="flex items-start gap-1.5 leading-snug">
            <t.Icon aria-hidden="true" className={`mt-px h-3.5 w-3.5 shrink-0 ${t.icon}`} strokeWidth={2.2} />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold text-ink">{s.role}</span>
              {s.name && <span className="text-content-muted"> · {s.name}</span>}
              <span className="text-content-muted">: </span>
              <span className={t.text}>{s.status}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
