import type { SupabaseClient } from '@supabase/supabase-js'

// The opt-outs a participant holds, for the admin event roster's pill and the
// roster CSV (tracker esign-native-engine.9, esign.optouts-staff).
//
// Read from what completion stored, which is the same for both signing engines:
// lib/esign/completion.ts calls recordCredentialOptOutFromForm (lib/docusign-optout.ts),
// which reads the boxes off the signed form through the envelope's own provider and
// writes agreements.form_opt_outs (each box found: true or false) and sets the
// media_opt_out, quote_opt_out and digital_comms_opt_out columns when a box is
// ticked. A column is only ever set, never cleared, so an opt-out recorded another
// way still counts. The box names are lib/esign/native/convert-docusign.ts's
// READ_BACK_FIELDS.
//
// Whose agreement: the participant's own (the form signed for this event) wins over
// the member's newest, and a coverage row resolves to the signed original, as the
// media answer does (lib/survey/media.ts loadMediaAgreements).

export const ROSTER_OPT_OUTS = ['media', 'quotes', 'digital_comms'] as const
export type RosterOptOut = (typeof ROSTER_OPT_OUTS)[number]

/** The read-back box and the agreements column for each opt-out. */
const SOURCES: Record<RosterOptOut, { box: 'MediaOptOut' | 'QuoteOptOut' | 'DigitalCommsOptOut'; column: 'media_opt_out' | 'quote_opt_out' | 'digital_comms_opt_out' }> = {
  media: { box: 'MediaOptOut', column: 'media_opt_out' },
  quotes: { box: 'QuoteOptOut', column: 'quote_opt_out' },
  digital_comms: { box: 'DigitalCommsOptOut', column: 'digital_comms_opt_out' },
}

/** Short names for the roster pill. */
export const ROSTER_OPT_OUT_LABEL: Record<RosterOptOut, string> = {
  media: 'Media',
  quotes: 'Quotes',
  digital_comms: 'Digital comms',
}

/** What each box says on the form, for the pill's title. */
export const ROSTER_OPT_OUT_DETAIL: Record<RosterOptOut, string> = {
  media: 'no photo or media use',
  quotes: 'no quoting their survey responses',
  digital_comms: 'no direct digital communications',
}

/**
 * One participant's answers: true opted out, false the box was read and left
 * unticked, null not known (no signed form, or the box was never read).
 */
export type OptOutAnswers = Record<RosterOptOut, boolean | null>

const UNKNOWN: OptOutAnswers = { media: null, quotes: null, digital_comms: null }

/** The opt-outs held, in display order. Empty when none. */
export function heldOptOuts(a: OptOutAnswers | undefined): RosterOptOut[] {
  return a ? ROSTER_OPT_OUTS.filter((k) => a[k] === true) : []
}

/** A CSV cell: yes (opted out), no (read, not ticked), or blank (not known). */
export function optOutCell(value: boolean | null | undefined): string {
  return value === true ? 'yes' : value === false ? 'no' : ''
}

/** The agreements that carry the boxes (lib/docusign-optout.ts reads only these). */
const OPT_OUT_ENVELOPES = ['minor', 'adult', 'mentor', 'volunteer']

const CHUNK = 200
const COLS = 'id, member_id, participant_id, completed_at, reused_from, media_opt_out, quote_opt_out, digital_comms_opt_out, form_opt_outs'

interface AgreementRow {
  id: string
  member_id: string | null
  participant_id: string | null
  completed_at: string | null
  reused_from: string | null
  media_opt_out: boolean | null
  quote_opt_out: boolean | null
  digital_comms_opt_out: boolean | null
  form_opt_outs: Record<string, unknown> | null
}

function answersOf(a: AgreementRow): OptOutAnswers {
  const out = { ...UNKNOWN }
  for (const k of ROSTER_OPT_OUTS) {
    const { box, column } = SOURCES[k]
    const read = a.form_opt_outs?.[box]
    if (a[column] === true || read === true) out[k] = true
    else if (read === false) out[k] = false
  }
  return out
}

/**
 * The opt-out answers for an event's participants, keyed by participant id. A
 * participant with no completed agreement that carries the boxes is left out.
 * Throws on a failed read, so a caller never shows a half-read answer as "none".
 */
export async function rosterOptOuts(
  db: SupabaseClient,
  participants: ReadonlyArray<{ id: string; member_id: string | null }>,
): Promise<Map<string, OptOutAnswers>> {
  const out = new Map<string, OptOutAnswers>()
  if (!participants.length) return out
  const participantIds = [...new Set(participants.map((p) => p.id))]
  const memberIds = [...new Set(participants.map((p) => p.member_id).filter(Boolean))] as string[]

  const rows: AgreementRow[] = []
  for (const [col, ids] of [['participant_id', participantIds], ['member_id', memberIds]] as const) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await db
        .from('agreements')
        .select(COLS)
        .in(col, ids.slice(i, i + CHUNK))
        .in('envelope_type', OPT_OUT_ENVELOPES)
        .eq('status', 'completed')
      if (error) throw new Error(`Reading agreements failed: ${error.message}`)
      rows.push(...((data ?? []) as AgreementRow[]))
    }
  }

  const rootIds = [...new Set(rows.map((r) => r.reused_from).filter(Boolean))] as string[]
  const roots = new Map<string, AgreementRow>()
  for (let i = 0; i < rootIds.length; i += CHUNK) {
    const { data, error } = await db.from('agreements').select(COLS).in('id', rootIds.slice(i, i + CHUNK)).eq('status', 'completed')
    if (error) throw new Error(`Reading original agreements failed: ${error.message}`)
    for (const r of (data ?? []) as AgreementRow[]) roots.set(r.id, r)
  }

  const newest = (list: AgreementRow[]) => [...list].sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))[0]
  for (const p of participants) {
    const own = rows.filter((r) => r.participant_id === p.id)
    const theirs = own.length ? own : rows.filter((r) => p.member_id && r.member_id === p.member_id)
    const top = theirs.length ? newest(theirs) : undefined
    if (!top) continue
    // A coverage row whose original is gone keeps what was recorded on it.
    const signed = top.reused_from ? roots.get(top.reused_from) ?? top : top
    out.set(p.id, answersOf(signed))
  }
  return out
}
