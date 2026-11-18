import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendEmail, reissue, resolveAudience, calls, EmailSendError } = vi.hoisted(() => {
  // Mirrors the real EmailSendError so the deliver loop's `instanceof` +
  // `isQuota` branch (deep review INT-2 / PUB-4) behaves as production does.
  class EmailSendError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.name = 'EmailSendError'; this.status = status }
    get isQuota() { return this.status === 429 }
  }
  return {
    sendEmail: vi.fn(async (_o: { to: string; subject: string; from?: string; replyTo?: string }) => {}),
    reissue: vi.fn(async (..._a: unknown[]) => ({ kind: 'resent' })),
    resolveAudience: vi.fn(async (..._a: unknown[]): Promise<{ recipients: unknown[]; docusignParticipantIds: string[] }> => ({ recipients: [], docusignParticipantIds: [] })),
    calls: { order: [] as string[] },
    EmailSendError,
  }
})

vi.mock('@/lib/community', () => ({ tiptapToPlainText: () => '', RESOURCES_BUCKET: 'community-resources' }))
vi.mock('@/lib/email', () => ({
  sendEmail: (o: { to: string; subject: string }) => { calls.order.push(`email:${o.to}`); return sendEmail(o) },
  EmailSendError,
}))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: (...a: unknown[]) => { calls.order.push('docusign'); return reissue(...a) } }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ title: 'CO SDC', date: '2026-10-03', venue: 'STEM School' }) }))
vi.mock('./audiences', () => ({ resolveAudience }))

const { sendEventEmail, reclaimStuckSending, sendableRecipients } = await import('./send')
const { markdownToTiptap } = await import('./defaults')

const EMAIL = {
  id: 'e1', event_slug: 'co', name: 'DocuSign chase', template_key: null, audiences: ['docusign_outstanding'],
  subject: '{{event_name}}: DocuSign', body_json: markdownToTiptap('Hi {{first_name}}'), attachments: [],
  resend_docusign: true, schedule_days_before: 5, status: 'scheduled', created_by: null, sent_at: null,
}

const R = (email: string, firstName: string) => ({
  email, firstName, name: firstName, roles: ['participant'], reasons: ['docusign_outstanding'],
  participantNames: [firstName], isParticipant: true, payments: [],
})

// Supabase stand-in with a real claim: the conditional UPDATE only matches
// while the row's status is draft/scheduled.
function fakeDb(row: typeof EMAIL) {
  const state = { row: { ...row }, sends: [] as Record<string, unknown>[], statusWrites: [] as string[], heartbeats: 0 as number | undefined }
  const db = {
    state,
    from(table: string) {
      if (table === 'event_emails') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...state.row } }) }) }),
          update: (values: { status: string }) => ({
            eq: () => {
              const claim = {
                in: (_c: string, allowed: string[]) => ({
                  select: async () => {
                    if (!allowed.includes(state.row.status)) return { data: [] }
                    state.row.status = values.status
                    state.statusWrites.push(values.status)
                    return { data: [{ id: row.id }] }
                  },
                }),
                then: (resolve: (v: unknown) => void) => {
                  state.row.status = values.status
                  state.statusWrites.push(values.status)
                  resolve({ error: null })
                },
                // The heartbeat: .eq('id').eq('status','sending'). Counted
                // apart from statusWrites so release/claim assertions stay exact.
                eq: (_c: string, v: string) => ({
                  then: (resolve: (v: unknown) => void) => {
                    if (state.row.status === v) state.heartbeats = (state.heartbeats ?? 0) + 1
                    resolve({ error: null })
                  },
                }),
              }
              return claim
            },
          }),
        }
      }
      // event_email_sends
      return {
        // alreadyTriedAddresses: .select('recipients').eq(...).neq('trigger','test')
        select: () => ({
          eq: () => ({
            neq: async (_c: string, v: string) => ({
              data: state.sends.filter((s) => (s as { trigger?: string }).trigger !== v)
                .map((s) => ({ recipients: (s as { recipients?: unknown }).recipients ?? [] })),
              error: null,
            }),
          }),
        }),
        insert: (values: Record<string, unknown>) => ({
          select: () => ({ single: async () => { state.sends.push({ ...values }); return { data: { id: `s${state.sends.length}` } } } }),
        }),
        // deliver now writes recipients incrementally AND a final counts update;
        // both are plain merges onto the current (last-inserted) send row.
        update: (values: Record<string, unknown>) => ({ eq: async () => { Object.assign(state.sends[state.sends.length - 1], values); return {} } }),
      }
    },
  }
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.order.length = 0
  resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo')], docusignParticipantIds: ['p1'] })
})

describe('sendEventEmail', () => {
  it('re-sends DocuSign first, emails each person from David, and records the send', async () => {
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, recipients: 2, sent: 2, failed: 0, docusignResent: 1 })
    expect(calls.order).toEqual(['docusign', 'email:a@example.com', 'email:b@example.com'])
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      subject: 'CO SDC: DocuSign',
      from: expect.stringContaining('David Shaw'),
      replyTo: 'david.shaw@stellreducation.org',
    })
    expect(db.state.row.status).toBe('sent')
    expect(db.state.sends[0]).toMatchObject({ trigger: 'schedule', subject: 'CO SDC: DocuSign', recipient_count: 2, sent_count: 2, docusign_resent: 1 })
  })

  it('does not re-send a Stellr signing agreement when the email itself carries the signing link', async () => {
    resolveAudience.mockResolvedValue({
      recipients: [R('a@example.com', 'Al')],
      docusignParticipantIds: ['p-docusign', 'p-native'],
      nativeParticipantIds: ['p-native'],
    } as never)
    const db = fakeDb({ ...EMAIL, body_json: markdownToTiptap('Hi {{first_name}}\n\n{{agreement_link}}') })
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(reissue.mock.calls.map((c) => c[1])).toEqual(['p-docusign'])

    // Without the link in the email, both are re-sent as before.
    reissue.mockClear()
    await sendEventEmail(fakeDb(EMAIL) as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(reissue.mock.calls.map((c) => c[1])).toEqual(['p-docusign', 'p-native'])
  })

  it('cannot send the same email twice', async () => {
    const db = fakeDb(EMAIL)
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    sendEmail.mockClear()
    const again = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(again).toMatchObject({ ok: false, status: 409 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a test goes only to the sender, leaves the status alone and re-sends no DocuSign', async () => {
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'test', testTo: 'me@stellreducation.org', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, recipients: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'me@stellreducation.org', subject: '[TEST] CO SDC: DocuSign' })
    expect(reissue).not.toHaveBeenCalled()
    expect(db.state.statusWrites).toEqual([])
    expect(db.state.sends[0]).toMatchObject({ trigger: 'test' })
  })

  it('records a failed recipient without stopping the rest', async () => {
    sendEmail.mockRejectedValueOnce(new Error('Resend 422'))
    const out = await sendEventEmail(fakeDb(EMAIL) as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, sent: 1, failed: 1 })
  })

  // deep review INT-2 / PUB-4: a bulk event-email blast is marketing against the
  // shared daily budget. When sendEmail refuses with a quota (429) error the
  // loop must STOP, must NOT record the unreached recipients (so they retry),
  // and the email must go back to its prior state — not be marked 'sent'.
  it('stops on a shared-budget quota error, leaving the rest unrecorded for retry and the email unsent', async () => {
    sendEmail.mockResolvedValueOnce(undefined) // Al goes out
    sendEmail.mockRejectedValueOnce(new EmailSendError('daily budget spent', 429)) // Bo hits the cap
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })

    expect(out).toMatchObject({ ok: true, sent: 1, failed: 0, incomplete: true })
    // Al went out; Bo hit the cap, so is listed as not reached (still owed), not as tried.
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['a@example.com', 'b@example.com'])
    const recorded = (db.state.sends[0].recipients as { email: string; status: string }[]) ?? []
    expect(recorded.map((r) => [r.email, r.status])).toEqual([['a@example.com', 'sent'], ['b@example.com', 'not_reached']])
    // Returned to 'scheduled' (its prior status) so the next cron slot resumes it.
    expect(db.state.row.status).toBe('scheduled')
    expect(db.state.statusWrites).toEqual(['sending', 'scheduled'])
  })

  it('a non-quota failure is NOT a budget stop: it records the failure and finishes (sent)', async () => {
    // Guards the mutation boundary — only an isQuota EmailSendError stops the loop.
    sendEmail.mockResolvedValueOnce(undefined)
    sendEmail.mockRejectedValueOnce(new Error('Resend 500'))
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, sent: 1, failed: 1 })
    expect(db.state.row.status).toBe('sent')
  })

  it('a manual send to nobody is refused and the email stays editable', async () => {
    resolveAudience.mockResolvedValue({ recipients: [], docusignParticipantIds: [] })
    const db = fakeDb({ ...EMAIL, status: 'draft' })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(db.state.row.status).toBe('draft')
  })

  it('refuses an email with a merge field it cannot fill, before claiming it', async () => {
    const db = fakeDb({ ...EMAIL, subject: 'Hi {{firstName}}' })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('{{firstName}}') })
    expect(db.state.statusWrites).toEqual([])
  })

  it('puts the email back if the audience cannot be resolved', async () => {
    resolveAudience.mockRejectedValueOnce(new Error('roster down'))
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(out).toMatchObject({ ok: false, status: 500 })
    expect(db.state.row.status).toBe('scheduled')
  })
})

// deep review INT-1: a send killed at the 60s budget is left stuck in 'sending'
// forever — the admin PATCH refuses with 409 and the cron only picks up
// 'scheduled'. reclaimStuckSending re-drives a row that has been 'sending'
// longer than the stale window, and the resumed send skips whoever the killed
// run already emailed.
function reclaimDb(opts: { updatedAt: string; priorSent: { email: string; status: string }[]; priorFinished?: boolean }) {
  const state = {
    row: { ...EMAIL, status: 'sending' as string, updated_at: opts.updatedAt },
    sends: [] as Record<string, unknown>[],
    statusWrites: [] as string[],
    // Seed a prior send row (killed unless priorFinished) so alreadyTried has something to skip.
    seeded: [{ trigger: 'schedule', recipients: opts.priorSent, finished_at: opts.priorFinished ? new Date().toISOString() : null }] as Record<string, unknown>[],
  }
  const db = {
    state,
    from(table: string) {
      if (table === 'event_emails') {
        return {
          select: (cols: string) => ({
            eq: (_c: string, _v: string) => ({
              // sendEventEmail's row read
              maybeSingle: async () => ({ data: { ...state.row } }),
              // reclaimStuckSending's listing: .eq('status','sending').lt('updated_at',stale).order()
              lt: (_c2: string, stale: string) => ({
                order: async () => ({
                  data: state.row.status === 'sending' && state.row.updated_at < stale ? [{ id: state.row.id }] : [],
                  error: null,
                }),
              }),
            }),
          }),
          update: (values: { status: string }) => ({
            eq: (_c: string, _v: string) => ({
              // resume CAS: .eq('status','sending').lt('updated_at',stale).select('id')
              eq: (_c2: string, wantStatus: string) => ({
                lt: (_c3: string, stale: string) => ({
                  select: async () => {
                    if (state.row.status !== wantStatus || !(state.row.updated_at < stale)) return { data: [] }
                    state.row.status = values.status
                    state.row.updated_at = new Date(Date.now() + 1).toISOString() // trigger bump: no second reclaim
                    state.statusWrites.push(values.status)
                    return { data: [{ id: state.row.id }] }
                  },
                }),
                // continue after a cleanly stopped run: .eq('updated_at', asRead).select('id')
                eq: (_c3: string, asRead: string) => ({
                  select: async () => {
                    if (state.row.status !== wantStatus || state.row.updated_at !== asRead) return { data: [] }
                    state.row.updated_at = new Date(Date.now() + 1).toISOString()
                    state.statusWrites.push(values.status)
                    return { data: [{ id: state.row.id }] }
                  },
                }),
              }),
              // release(): plain awaited update
              then: (resolve: (v: unknown) => void) => {
                state.row.status = values.status
                state.statusWrites.push(values.status)
                resolve({ error: null })
              },
            }),
          }),
        }
      }
      // event_email_sends
      return {
        select: () => ({
          eq: () => ({
            neq: (_c: string, v: string) => {
              const rows = [...state.seeded, ...state.sends].filter((s) => (s as { trigger?: string }).trigger !== v)
              return {
                // alreadyTriedAddresses awaits this directly
                then: (resolve: (x: unknown) => void) => resolve({
                  data: rows.map((s) => ({ recipients: (s as { recipients?: unknown }).recipients ?? [] })),
                  error: null,
                }),
                // latestRunFinished: .order().limit(1).maybeSingle()
                order: () => ({ limit: () => ({ maybeSingle: async () => ({
                  data: rows.length ? { finished_at: (rows[rows.length - 1] as { finished_at?: string | null }).finished_at ?? null } : null,
                  error: null,
                }) }) }),
              }
            },
          }),
        }),
        insert: (values: Record<string, unknown>) => ({
          select: () => ({ single: async () => { state.sends.push({ ...values }); return { data: { id: `s${state.sends.length}` } } } }),
        }),
        update: (values: Record<string, unknown>) => ({ eq: async () => { Object.assign(state.sends[state.sends.length - 1], values); return {} } }),
      }
    },
  }
  return db
}

describe('reclaimStuckSending', () => {
  beforeEach(() => {
    resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo')], docusignParticipantIds: [] })
  })

  it('resumes a stale send and emails only the recipients the killed run had not reached', async () => {
    const old = new Date(Date.now() - 20 * 60_000).toISOString()
    const db = reclaimDb({ updatedAt: old, priorSent: [{ email: 'a@example.com', status: 'sent' }] })
    const out = await reclaimStuckSending(db as never, () => true)
    expect(out).toMatchObject({ reclaimed: 1, errors: [] })
    // Al already had it; only Bo is emailed on resume.
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['b@example.com'])
    expect(db.state.row.status).toBe('sent')
  })

  it('leaves a fresh (in-progress) send alone', async () => {
    const db = reclaimDb({ updatedAt: new Date().toISOString(), priorSent: [] })
    const out = await reclaimStuckSending(db as never, () => true)
    expect(out).toMatchObject({ reclaimed: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(db.state.row.status).toBe('sending')
  })
})

// member-merge-school-email.12: Resend refused `to: none` from this cron. An
// address that cannot be an email is left out before anything is sent, and the
// log gives a count, never the address.
describe('recipients with no valid email address', () => {
  it('sendableRecipients keeps real addresses and logs only how many were skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const list = [
      R('a@example.com', 'Al'), R('none', 'Guardian'), R('', 'Blank'), R('no-at-sign.example.com', 'NoAt'),
      R('two@@example.com', 'Two'), R('  ', 'Space'), { ...R('x', 'Missing'), email: undefined as unknown as string },
    ]
    expect(sendableRecipients(list, 'e1').map((r) => r.email)).toEqual(['a@example.com'])
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('skipped 6 recipient(s)')
    expect(line).toContain('e1')
    expect(line).not.toContain('none')
    expect(line).not.toContain('no-at-sign')
    warn.mockClear()
    sendableRecipients([R('b@example.com', 'Bo')], 'e1')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('the cron’s send skips "none", empty and @-less addresses and records only the real ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveAudience.mockResolvedValue({
      recipients: [R('a@example.com', 'Al'), R('none', 'Guardian'), R('', 'Blank'), R('bo-at-example.com', 'Bo')],
      docusignParticipantIds: [],
    })
    const db = fakeDb({ ...EMAIL, resend_docusign: false })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, recipients: 1, sent: 1, failed: 0 })
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['a@example.com'])
    expect(db.state.sends[0]).toMatchObject({ recipient_count: 1, sent_count: 1, failed_count: 0 })
    expect(JSON.stringify(db.state.sends)).not.toContain('"none"')
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(['[event-emails] email e1: skipped 3 recipient(s) with no valid email address'])
    warn.mockRestore()
  })

  it('a manual send whose only recipients are invalid sends nothing and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveAudience.mockResolvedValue({ recipients: [R('none', 'Guardian')], docusignParticipantIds: [] })
    const db = fakeDb({ ...EMAIL, status: 'draft', resend_docusign: false })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

// 17 Nov 2026: a manual send to the MN consent group spent its 60s function on
// DocuSign re-sends, was killed after two emails, showed "Send failed." and was
// left stuck in 'sending'. A run now stops cleanly at its deadline, re-sends
// DocuSign only on the first run, and can be continued straight away.
describe('time-limited runs', () => {
  it('stops between recipients at its deadline, records the run, and stays sending to be continued', async () => {
    const db = fakeDb(EMAIL)
    // Room for the first recipient only: the second would start inside the margin.
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 200, deadline: Date.now() + 3_100 })
    expect(out).toMatchObject({ ok: true, sent: 1, incomplete: true, stoppedFor: 'time', remaining: 1 })
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['a@example.com'])
    // Claimed, never released: still 'sending' for the continue.
    expect(db.state.statusWrites).toEqual(['sending'])
    expect(db.state.row.status).toBe('sending')
    // The run itself is finished, with honest counts.
    expect(db.state.sends[0]).toMatchObject({ recipient_count: 2, sent_count: 1, finished_at: expect.any(String) })
  })

  it('a continued run skips everyone already reached and does not re-send DocuSign', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    const db = reclaimDb({ updatedAt: recent, priorSent: [{ email: 'a@example.com', status: 'sent' }] })
    resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo')], docusignParticipantIds: ['p1'] })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0, resume: true, staleMs: 20_000 })
    expect(out).toMatchObject({ ok: true, sent: 1 })
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['b@example.com'])
    expect(reissue).not.toHaveBeenCalled()
    expect(db.state.row.status).toBe('sent')
  })

  it('a continue is refused while the last run is still alive (fresh heartbeat)', async () => {
    const db = reclaimDb({ updatedAt: new Date().toISOString(), priorSent: [] })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0, resume: true, staleMs: 20_000 })
    expect(out).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('still sending') })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a continue takes over at once from a run that stopped cleanly (fresh heartbeat, finished run)', async () => {
    const db = reclaimDb({ updatedAt: new Date().toISOString(), priorSent: [{ email: 'a@example.com', status: 'sent' }], priorFinished: true })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0, resume: true, staleMs: 20_000 })
    expect(out).toMatchObject({ ok: true, sent: 1 })
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['b@example.com'])
    expect(db.state.row.status).toBe('sent')
  })

  it('a continue with nobody left marks the email sent instead of refusing', async () => {
    const old = new Date(Date.now() - 60_000).toISOString()
    const db = reclaimDb({ updatedAt: old, priorSent: [{ email: 'a@example.com', status: 'sent' }, { email: 'b@example.com', status: 'sent' }] })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0, resume: true, staleMs: 20_000 })
    expect(out).toMatchObject({ ok: true, sent: 0 })
    expect(db.state.row.status).toBe('sent')
  })

  it('the DocuSign step stops at its time cap instead of using up the run', async () => {
    resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al')], docusignParticipantIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] })
    // Deadline leaves no room for DocuSign at all (cap = deadline − margin − 10s).
    const out = await sendEventEmail(fakeDb(EMAIL) as never, 'e1', { trigger: 'manual', spacingMs: 0, deadline: Date.now() + 12_500 })
    expect(reissue).not.toHaveBeenCalled()
    expect(out).toMatchObject({ ok: true, sent: 1 })
  })

  it('heartbeats while it works, so a live run is never taken as stuck', async () => {
    const db = fakeDb(EMAIL)
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(db.state.heartbeats).toBeGreaterThanOrEqual(2)
  })
})

// 17 Nov 2026: a run killed after Resend accepted a message but before the
// result was saved emailed that parent again on the next run.
describe('nobody is emailed twice, and History can tell who is still owed', () => {
  it('records the address as sending BEFORE handing it to Resend', async () => {
    const db = fakeDb(EMAIL)
    let atSend: unknown = null
    sendEmail.mockImplementationOnce(async () => {
      atSend = JSON.parse(JSON.stringify(db.state.sends[0].recipients))
      return { id: 're_1' } as never
    })
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(atSend).toEqual([expect.objectContaining({ email: 'a@example.com', status: 'sending' })])
    const rec = db.state.sends[0].recipients as { status: string }[]
    expect(rec.map((r) => r.status)).toEqual(['sent', 'sent'])
  })

  it('a run stopped at its deadline lists who it did not reach as not_reached', async () => {
    const db = fakeDb(EMAIL)
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 200, deadline: Date.now() + 3_100 })
    const rec = db.state.sends[0].recipients as { email: string; status: string }[]
    expect(rec.map((r) => [r.email, r.status])).toEqual([['a@example.com', 'sent'], ['b@example.com', 'not_reached']])
  })

  it('the next run emails the not_reached, and skips an address caught mid-send', async () => {
    const old = new Date(Date.now() - 60_000).toISOString()
    const db = reclaimDb({
      updatedAt: old,
      priorSent: [{ email: 'a@example.com', status: 'sending' }, { email: 'b@example.com', status: 'not_reached' }],
    })
    resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo')], docusignParticipantIds: [] })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0, resume: true, staleMs: 20_000 })
    expect(out).toMatchObject({ ok: true, sent: 1 })
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['b@example.com'])
  })
})

describe('recipients sendEmail did not deliver', () => {
  it('records suppressed and queued recipients as such, not as sent', async () => {
    sendEmail.mockResolvedValueOnce({ id: null, suppressed: true } as never)
    sendEmail.mockResolvedValueOnce({ id: null, queued: true } as never)
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, sent: 1, suppressed: 1, failed: 0 })
    const rec = db.state.sends[0].recipients as { email: string; status: string }[]
    expect(rec.map((r) => r.status)).toEqual(['suppressed', 'queued'])
    expect(db.state.sends[0]).toMatchObject({ sent_count: 1, failed_count: 0 })
  })

  it('keeps Resend’s id on each recipient it accepted', async () => {
    sendEmail.mockResolvedValueOnce({ id: 're_1' } as never)
    const db = fakeDb(EMAIL)
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    const rec = db.state.sends[0].recipients as { resendId?: string }[]
    expect(rec[0].resendId).toBe('re_1')
  })
})
