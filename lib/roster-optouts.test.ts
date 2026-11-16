import { describe, it, expect, beforeEach } from 'vitest'
import { createRecorder, type DbCall, type DbResult } from '@/test/registration/fixtures'
import { heldOptOuts, optOutCell, rosterOptOuts, type OptOutAnswers } from './roster-optouts'

// esign-native-engine.9: the roster reads each participant's opt-outs from what
// completion stored for either signing engine (agreements.form_opt_outs and the
// opt-out columns), from the form signed for the event, else the member's newest.

const rec = createRecorder()
const db = rec.client()

const agreement = (over: Record<string, unknown>) => ({
  id: 'agr',
  member_id: null,
  participant_id: null,
  completed_at: '2026-10-01T00:00:00Z',
  reused_from: null,
  media_opt_out: null,
  quote_opt_out: null,
  digital_comms_opt_out: null,
  form_opt_outs: null,
  ...over,
})

function arrange(rows: unknown[], roots: unknown[] = []) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table !== 'agreements') return undefined
    if (c.filters.some((f) => f[0] === 'in' && f[1] === 'id')) return { data: roots, error: null }
    const col = c.filters.find((f) => f[0] === 'in' && (f[1] === 'participant_id' || f[1] === 'member_id'))!
    const ids = col[2] as string[]
    return { data: rows.filter((r) => ids.includes((r as Record<string, string>)[col[1] as string])), error: null }
  })
}

beforeEach(() => rec.reset())

describe('rosterOptOuts', () => {
  it('a native signature: the boxes read back into form_opt_outs and the columns', async () => {
    arrange([agreement({ id: 'n1', participant_id: 'p-1', media_opt_out: true, form_opt_outs: { MediaOptOut: true, QuoteOptOut: false, DigitalCommsOptOut: true } })])
    const out = await rosterOptOuts(db, [{ id: 'p-1', member_id: null }])
    expect(out.get('p-1')).toEqual({ media: true, quotes: false, digital_comms: true })
    expect(heldOptOuts(out.get('p-1'))).toEqual(['media', 'digital_comms'])
  })

  it('a DocuSign form: a ticked column counts even where the read-back is missing', async () => {
    arrange([agreement({ id: 'd1', participant_id: 'p-1', quote_opt_out: true, form_opt_outs: null })])
    const out = await rosterOptOuts(db, [{ id: 'p-1', member_id: null }])
    expect(out.get('p-1')).toEqual({ media: null, quotes: true, digital_comms: null })
  })

  it('nothing ticked: no opt-outs held, so no pill', async () => {
    arrange([agreement({ id: 'x', participant_id: 'p-1', form_opt_outs: { MediaOptOut: false, QuoteOptOut: false, DigitalCommsOptOut: false } })])
    const out = await rosterOptOuts(db, [{ id: 'p-1', member_id: null }])
    expect(heldOptOuts(out.get('p-1'))).toEqual([])
  })

  it('the form signed for the event wins over the member’s newer one', async () => {
    arrange([
      agreement({ id: 'own', participant_id: 'p-1', member_id: 'm-1', completed_at: '2026-09-01T00:00:00Z', form_opt_outs: { QuoteOptOut: true } }),
      agreement({ id: 'later', participant_id: 'p-9', member_id: 'm-1', completed_at: '2026-10-01T00:00:00Z', media_opt_out: true }),
    ])
    const out = await rosterOptOuts(db, [{ id: 'p-1', member_id: 'm-1' }])
    expect(heldOptOuts(out.get('p-1'))).toEqual(['quotes'])
  })

  it('with no form of their own, the member’s newest; a coverage row reads the signed original', async () => {
    arrange(
      [
        agreement({ id: 'old', member_id: 'm-2', completed_at: '2026-01-01T00:00:00Z', media_opt_out: true }),
        agreement({ id: 'cover', member_id: 'm-2', completed_at: '2026-10-01T00:00:00Z', reused_from: 'root' }),
      ],
      [agreement({ id: 'root', member_id: 'm-2', form_opt_outs: { DigitalCommsOptOut: true } })],
    )
    const out = await rosterOptOuts(db, [{ id: 'p-2', member_id: 'm-2' }])
    expect(heldOptOuts(out.get('p-2'))).toEqual(['digital_comms'])
  })

  it('reads only completed agreements that carry the boxes', async () => {
    arrange([])
    await rosterOptOuts(db, [{ id: 'p-1', member_id: 'm-1' }])
    for (const c of rec.calls) {
      expect(c.filters).toEqual(expect.arrayContaining([['in', 'envelope_type', ['minor', 'adult', 'mentor', 'volunteer']], ['eq', 'status', 'completed']]))
    }
  })

  it('no agreement: left out, and nothing read for an empty roster', async () => {
    arrange([])
    expect((await rosterOptOuts(db, [{ id: 'p-1', member_id: null }])).has('p-1')).toBe(false)
    rec.reset()
    expect((await rosterOptOuts(db, [])).size).toBe(0)
    expect(rec.calls).toEqual([])
  })

  it('a failed read throws', async () => {
    rec.respond(() => ({ data: null, error: { message: 'down' } }))
    await expect(rosterOptOuts(db, [{ id: 'p-1', member_id: null }])).rejects.toThrow('down')
  })
})

describe('helpers', () => {
  it('optOutCell: yes, no, or blank when not known', () => {
    expect([optOutCell(true), optOutCell(false), optOutCell(null), optOutCell(undefined)]).toEqual(['yes', 'no', '', ''])
  })

  it('heldOptOuts keeps display order and ignores unknowns', () => {
    const a: OptOutAnswers = { media: null, quotes: true, digital_comms: true }
    expect(heldOptOuts(a)).toEqual(['quotes', 'digital_comms'])
    expect(heldOptOuts(undefined)).toEqual([])
  })
})
