import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { groupSends, nextCronRun, sendGroupCsv, EVENT_EMAIL_CRON_UTC_HOURS } from './send-groups'
import type { EventEmailSendRow, RecipientSendStatus } from './types'

const NOW = new Date('2026-11-18T16:00:00Z')

let n = 0
function run(over: Partial<EventEmailSendRow> & { list?: [string, RecipientSendStatus][] }): EventEmailSendRow {
  const { list = [], ...rest } = over
  return {
    id: `s${++n}`,
    event_email_id: 'e1',
    email_name: 'Outstanding consent form',
    subject: 'Your consent form is still outstanding',
    audiences: ['docusign_outstanding'],
    trigger: 'schedule',
    triggered_by: 'schedule',
    recipient_count: list.length,
    sent_count: 0,
    failed_count: 0,
    docusign_resent: 0,
    recipients: list.map(([email, status]) => ({ email, name: email.split('@')[0], roles: ['guardian'], status })),
    started_at: '2026-11-17T15:56:00Z',
    finished_at: '2026-11-17T15:57:00Z',
    ...rest,
  }
}

const addr = (i: number) => `p${i}@example.com`
const sent = (from: number, to: number): [string, RecipientSendStatus][] =>
  Array.from({ length: to - from }, (_, i) => [addr(from + i), 'sent'])

describe('groupSends', () => {
  it('folds an email’s runs into one send, and keeps tests and catch-ups apart', () => {
    const groups = groupSends([
      run({ list: sent(0, 2), started_at: '2026-11-17T15:00:00Z' }),
      run({ list: sent(2, 4), started_at: '2026-11-17T17:00:00Z' }),
      run({ trigger: 'test', list: [['me@example.com', 'sent']], started_at: '2026-11-17T14:00:00Z' }),
      run({ trigger: 'catch_up', list: sent(9, 10), started_at: '2026-11-18T15:00:00Z' }),
    ], [{ id: 'e1', status: 'sent', updated_at: '2026-11-17T17:01:00Z' }], NOW)
    expect(groups.map((g) => [g.trigger, g.runs.length])).toEqual([['catch_up', 1], ['schedule', 2], ['test', 1]])
    expect(groups[1]).toMatchObject({ status: { kind: 'finished' }, planned: 2 })
    expect(groups[1].counts.delivered).toBe(4)
  })

  // The 16–17 Nov Minnesota consent send, as recorded by the code of the time:
  // runs did not list who they missed, and one parent was emailed again.
  it('reads the old 46 → 37 → 19 → 2 pattern as one finished send with 8 who left the group', () => {
    const groups = groupSends([
      run({ trigger: 'manual', triggered_by: 'Staff', recipient_count: 46, list: sent(0, 2), started_at: '2026-11-16T23:02:00Z', finished_at: null }),
      run({ recipient_count: 37, list: sent(2, 19), started_at: '2026-11-17T15:56:00Z', finished_at: null }),
      run({ recipient_count: 19, list: sent(19, 36), started_at: '2026-11-17T17:07:00Z', finished_at: null }),
      run({ recipient_count: 2, list: sent(36, 38), started_at: '2026-11-17T19:49:00Z' }),
    ], [{ id: 'e1', status: 'sent', updated_at: '2026-11-17T19:50:00Z' }], NOW)
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.status).toEqual({ kind: 'finished' })
    expect(g.planned).toBe(46)
    expect(g.counts).toMatchObject({ delivered: 38, left_list: 8, waiting: 0 })
  })

  it('names who is still waiting, who left the group, who was caught mid-send, and who was emailed twice', () => {
    const groups = groupSends([
      run({ list: [[addr(1), 'sent'], [addr(2), 'sending'], [addr(3), 'not_reached'], [addr(4), 'not_reached']], started_at: '2026-11-17T15:00:00Z' }),
      // p3 signed in between (not on this run's list); p4 reached; p1 emailed again.
      run({ list: [[addr(4), 'sent'], [addr(1), 'sent'], [addr(5), 'not_reached']], started_at: '2026-11-17T17:00:00Z' }),
    ], [{ id: 'e1', status: 'scheduled', updated_at: '2026-11-17T17:01:00Z' }], NOW)
    const g = groups[0]
    const by = Object.fromEntries(g.recipients.map((p) => [p.email, p]))
    expect(by[addr(1)]).toMatchObject({ outcome: 'delivered', times: 2 })
    expect(by[addr(2)].outcome).toBe('unconfirmed')
    expect(by[addr(3)].outcome).toBe('left_list')
    expect(by[addr(4)].outcome).toBe('delivered')
    expect(by[addr(5)].outcome).toBe('waiting')
    expect(g.duplicates).toBe(1)
    expect(g.status).toEqual({ kind: 'paused', resumeNow: false, nextRunAt: '2026-11-18T17:00:00.000Z' })
    // Problems first in the list.
    expect(g.recipients[0].outcome).toBe('unconfirmed')
  })

  it('a finished send with a bounce or a mid-send cut-off is "finished with problems"', () => {
    const r = run({ list: [[addr(1), 'sent'], [addr(2), 'sent']] })
    r.recipients[1].blocked = 'bounce'
    const [g] = groupSends([r], [{ id: 'e1', status: 'sent', updated_at: r.finished_at! }], NOW)
    expect(g.status.kind).toBe('finished_with_problems')
    expect(g.counts).toMatchObject({ delivered: 1, blocked: 1 })
  })

  it('a send stuck in sending is waiting for Resume now; a live one is sending', () => {
    const stuck = run({ list: [[addr(1), 'sent'], [addr(2), 'not_reached']], started_at: '2026-11-18T15:00:00Z', finished_at: '2026-11-18T15:01:00Z' })
    const [g] = groupSends([stuck], [{ id: 'e1', status: 'sending', updated_at: '2026-11-18T15:01:00Z' }], NOW)
    expect(g.status).toMatchObject({ kind: 'paused', resumeNow: true })

    const live = run({ list: [[addr(1), 'sent'], [addr(2), 'sending']], started_at: '2026-11-18T15:59:30Z', finished_at: null })
    const [l] = groupSends([live], [{ id: 'e1', status: 'sending', updated_at: '2026-11-18T15:59:55Z' }], NOW)
    expect(l.status.kind).toBe('sending')
    expect(l.counts.sending).toBe(1)
  })

  it('CSV has one row per person and quotes commas', () => {
    const [g] = groupSends([run({ list: [[addr(1), 'failed']] })], [], NOW)
    g.recipients[0].error = 'bad, address'
    const csv = sendGroupCsv(g, (r) => r).split('\n')
    expect(csv[1]).toBe('Name,Email,Roles,Result,Times emailed,Run (UTC),Detail')
    expect(csv[2]).toContain('"bad, address"')
    expect(csv).toHaveLength(3)
  })
})

describe('nextCronRun', () => {
  it('picks the next slot today, or tomorrow’s first', () => {
    expect(nextCronRun(new Date('2026-11-18T16:00:00Z'))).toBe('2026-11-18T17:00:00.000Z')
    expect(nextCronRun(new Date('2026-11-18T20:00:00Z'))).toBe('2026-11-19T15:00:00.000Z')
  })

  it('matches the event-email cron in vercel.json', () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] }
    const hours = cfg.crons
      .filter((c) => c.path === '/api/cron/event-emails')
      .map((c) => Number(c.schedule.split(' ')[1]))
      .sort((a, b) => a - b)
    expect(hours).toEqual([...EVENT_EMAIL_CRON_UTC_HOURS])
  })
})
