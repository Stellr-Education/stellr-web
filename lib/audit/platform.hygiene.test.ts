// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/audit/platform.ts, the rows that can never be erased: every word and
// fragment on the personal-data key denylist, each value shape the metadata
// allow-list keeps or redacts, and the edges of audit(), recordAuditFailure()
// and the off-database verification (platform.test.ts covers the chain rules).

const capture = vi.fn()
vi.mock('@/lib/app-errors', () => ({ captureRequestError: (...a: unknown[]) => capture(...a) }))
const serverClient = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => serverClient() }))

type Platform = typeof import('./platform')
let audit: Platform['audit']
let auditClient: Platform['auditClient']
let isDeniedKey: Platform['isDeniedKey']
let isIdShaped: Platform['isIdShaped']
let sanitizeMetadata: Platform['sanitizeMetadata']
let cleanReason: Platform['cleanReason']
let recordAuditFailure: Platform['recordAuditFailure']
let canonicalTimestamp: Platform['canonicalTimestamp']
let byteaHex: Platform['byteaHex']
let rowHash: Platform['rowHash']
let canonicalRow: Platform['canonicalRow']
let checkRows: Platform['checkRows']
let verifyChain: Platform['verifyChain']
let checkRecordedHeads: Platform['checkRecordedHeads']
let inferActorKind: Platform['inferActorKind']
let AUDIT_TIMEOUT_MS: Platform['AUDIT_TIMEOUT_MS']
let RECORD_FAILURE_TIMEOUT_MS: Platform['RECORD_FAILURE_TIMEOUT_MS']
let MAX_REASON: Platform['MAX_REASON']
let MAX_CODE: Platform['MAX_CODE']
let REDACTED: Platform['REDACTED']
let VERIFY_COLUMNS: Platform['VERIFY_COLUMNS']

// Module-level tables (the denylist, the value patterns, the bounds) are read
// when the module loads, so it is loaded afresh before each test: a mutation
// run (stryker.config.mjs) switches a mutant on after a file's static imports
// have run, and only a load inside the test sees it.
beforeEach(async () => {
  vi.resetModules()
  ;({ audit, auditClient, isDeniedKey, isIdShaped, sanitizeMetadata, cleanReason, recordAuditFailure, canonicalTimestamp, byteaHex, rowHash, canonicalRow, checkRows, verifyChain, checkRecordedHeads, inferActorKind, AUDIT_TIMEOUT_MS, RECORD_FAILURE_TIMEOUT_MS, MAX_REASON, MAX_CODE, REDACTED, VERIFY_COLUMNS } = await import('./platform'))
})

const UUID = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  capture.mockReset()
  serverClient.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('constants', () => {
  it('match the table CHECKs and the documented bounds', () => {
    expect([AUDIT_TIMEOUT_MS, RECORD_FAILURE_TIMEOUT_MS, MAX_REASON, MAX_CODE, REDACTED]).toEqual([2500, 500, 500, 80, '[redacted]'])
    expect(VERIFY_COLUMNS).toBe(
      'id, tenant_id, chain_seq, actor, actor_kind, action, target_table, target_id, reason, metadata_text:metadata::text, occurred_at, prev_hash, hash',
    )
  })

  it('auditClient is the server client', () => {
    const c = { tag: 'server' }
    serverClient.mockReturnValue(c)
    expect(auditClient()).toBe(c)
  })
})

describe('isDeniedKey: every denied word, on its own', () => {
  // Each must be denied as a whole key, and as one word of a longer key.
  const WORDS = [
    'name', 'names', 'firstname', 'lastname', 'fullname', 'displayname', 'nickname', 'surname', 'username',
    'email', 'emails', 'phone', 'phones', 'mobile', 'tel', 'telephone',
    'dob', 'birth', 'birthdate', 'birthday', 'born', 'age', 'ages', 'grade', 'gender', 'sex', 'pronouns',
    'address', 'street', 'city', 'postcode', 'zip', 'zipcode', 'school',
    'ip', 'ipaddress', 'useragent', 'password', 'token', 'secret',
    'medical', 'health', 'allergies', 'allergy', 'condition', 'conditions', 'diagnosis', 'medication',
    'medications', 'dietary', 'disability', 'emergencycontact', 'guardian', 'parent', 'mother', 'father',
    'note', 'notes', 'comment', 'comments', 'message', 'body', 'text', 'description', 'bio',
  ]
  for (const w of WORDS) {
    it(w, () => {
      expect(isDeniedKey(w)).toBe(true)
      expect(isDeniedKey(`x_${w}`)).toBe(true)
    })
  }

  it('every fragment is denied inside a single lower-case word', () => {
    for (const f of ['name', 'email', 'phone', 'birth', 'medical', 'allerg', 'diagnos', 'address', 'postcode', 'password', 'secret']) {
      expect(isDeniedKey(`zz${f}zz`), f).toBe(true)
    }
  })

  it('splits camelCase, PascalCase acronyms, snake_case and kebab-case into words', () => {
    expect(isDeniedKey('studentAge')).toBe(true)
    expect(isDeniedKey('IPCount')).toBe(true)
    expect(isDeniedKey('userIP')).toBe(true)
    expect(isDeniedKey('page-age')).toBe(true)
    expect(isDeniedKey('page__age')).toBe(true)
    expect(isDeniedKey('Age')).toBe(true)
  })

  it('keeps keys whose words are not personal data, even when a denied word is a substring', () => {
    for (const k of ['pageCount', 'stage', 'messageCount' /* message is a word here */, 'usage', 'stip', 'tipCount', 'textile']) {
      // messageCount → ['message','count']: denied by the word list.
      if (k === 'messageCount') expect(isDeniedKey(k)).toBe(true)
      else expect(isDeniedKey(k), k).toBe(false)
    }
  })
})

describe('isIdShaped', () => {
  it('accepts uuids, lower-case codes and mixed-case ids carrying a digit or underscore', () => {
    for (const v of [UUID, UUID.toUpperCase(), 'replaced', 'paid_seat', 'nevada-2026', 'ticket:4521', 'a.b#c', '9lives', 'user_2abc', 'cs_test_1', 'Ab1', 'A_b']) {
      expect(isIdShaped(v), v).toBe(true)
    }
  })

  it('refuses empty, too long, free text, names, dates and odd leading characters', () => {
    for (const v of ['', 'a'.repeat(81), 'two words', 'Jane', 'JaneDoe', '2026-11-04', '04/11/2026', '4.11.26', '-code', '_code', 'Ab-', 'user!1', 'A b1']) {
      expect(isIdShaped(v), v).toBe(false)
    }
    expect(isIdShaped('a'.repeat(80))).toBe(true)
  })

  it('a code must be lower-case: one capital makes it need a digit or underscore', () => {
    expect(isIdShaped('paidSeat')).toBe(false)
    expect(isIdShaped('paidSeat2')).toBe(true)
  })

  it('anchors every pattern: an id inside other text is not an id', () => {
    expect(isIdShaped(`${UUID} x`)).toBe(false)
    expect(isIdShaped(`x${UUID}`)).toBe(true) // still a lower-case code
    expect(isIdShaped(`X${UUID}`)).toBe(true) // mixed id with digits
    expect(isIdShaped(`!${UUID}`)).toBe(false)
  })
})

describe('sanitizeMetadata values', () => {
  it('keeps null, booleans and finite numbers; drops NaN, Infinity, objects, functions and undefined', () => {
    expect(
      sanitizeMetadata({
        a: null,
        b: true,
        c: false,
        d: 0,
        e: -1.5,
        f: Number.NaN,
        g: Number.POSITIVE_INFINITY,
        h: { x: 1 },
        i: () => 1,
        j: undefined,
        k: BigInt(10) as unknown as number,
      }),
    ).toEqual({ a: null, b: true, c: false, d: 0, e: -1.5 })
  })

  it('emails anywhere in a value become [email]', () => {
    expect(sanitizeMetadata({ ref: 'contact kid@school.test now' })).toEqual({ ref: '[email]' })
    expect(sanitizeMetadata({ ref: 'A.B+c@Example.ORG' })).toEqual({ ref: '[email]' })
  })

  it('a whole value shaped like a phone number with 9 to 15 digits becomes [phone]', () => {
    expect(sanitizeMetadata({ a: '+1 (702) 555-0100' })).toEqual({ a: '[phone]' })
    expect(sanitizeMetadata({ a: '123456789' })).toEqual({ a: '[phone]' })
    expect(sanitizeMetadata({ a: '123456789012345' })).toEqual({ a: '[phone]' })
    // 16 digits: not a phone; a lower-case code of digits stays.
    expect(sanitizeMetadata({ a: '1234567890123456' })).toEqual({ a: '1234567890123456' })
    // 8 digits: too short to be a phone, and a code.
    expect(sanitizeMetadata({ a: '12345678' })).toEqual({ a: '12345678' })
    // Phone-shaped with letters around it: not a phone.
    expect(sanitizeMetadata({ a: 'x123456789' })).toEqual({ a: 'x123456789' })
    // Nine phone characters but too few digits: free text, redacted.
    expect(sanitizeMetadata({ a: '(1) (2) (3)' })).toEqual({ a: REDACTED })
  })

  it('arrays keep at most 20 cleaned items and drop the ones that clean to nothing', () => {
    const long = Array.from({ length: 25 }, (_, i) => `id_${i}`)
    expect(sanitizeMetadata({ ids: long })).toEqual({ ids: long.slice(0, 20) })
    expect(sanitizeMetadata({ ids: ['a1', { x: 1 }, 'Jane Doe', 3, null, Number.NaN] })).toEqual({ ids: ['a1', REDACTED, 3, null] })
    expect(sanitizeMetadata({ ids: [] })).toEqual({ ids: [] })
  })

  it('stops at 32 keys, counting only kept keys', () => {
    const input: Record<string, unknown> = { email: 'x', note: 'y' }
    for (let i = 0; i < 40; i++) input[`k${i}`] = i
    const out = sanitizeMetadata(input)
    expect(Object.keys(out)).toHaveLength(32)
    expect(out.k0).toBe(0)
    expect(out.k31).toBe(31)
    expect(out.k32).toBeUndefined()
  })

  it('keys must start with a letter and be at most 64 word characters', () => {
    const out = sanitizeMetadata({ a: 1, ['a'.repeat(64)]: 2, ['a'.repeat(65)]: 3, '1a': 4, _a: 5, 'a-b': 6, 'a b': 7, Ab9_: 8 })
    expect(out).toEqual({ a: 1, ['a'.repeat(64)]: 2, Ab9_: 8 })
  })

  it('returns {} for anything that is not a plain object', () => {
    expect(sanitizeMetadata(null)).toEqual({})
    expect(sanitizeMetadata(undefined)).toEqual({})
    expect(sanitizeMetadata(['a'] as unknown as Record<string, unknown>)).toEqual({})
    expect(sanitizeMetadata('abc' as unknown as Record<string, unknown>)).toEqual({})
  })
})

describe('cleanReason', () => {
  it('trims, keeps an id-shaped reason, redacts the rest, empty → null', () => {
    expect(cleanReason('  ticket:4521  ')).toBe('ticket:4521')
    expect(cleanReason('   ')).toBeNull()
    expect(cleanReason('')).toBeNull()
    expect(cleanReason(null)).toBeNull()
    expect(cleanReason(undefined)).toBeNull()
    expect(cleanReason('Jane asked')).toBe(REDACTED)
  })
})

describe('inferActorKind', () => {
  it('needs the exact prefix', () => {
    expect(inferActorKind('system')).toBe('system')
    expect(inferActorKind('systems')).toBe('user')
    expect(inferActorKind('cron:x')).toBe('cron')
    expect(inferActorKind('xcron:x')).toBe('user')
    expect(inferActorKind('webhook:stripe')).toBe('webhook')
    expect(inferActorKind('my-webhook:x')).toBe('user')
  })
})

describe('recordAuditFailure', () => {
  it('logs the message and records it in app_errors under the action', async () => {
    capture.mockResolvedValue(undefined)
    const err = new Error('db down')
    const db = { tag: 'db' }
    await recordAuditFailure(err, 'support.impersonate.start', db as never)
    expect(console.error).toHaveBeenCalledWith('[platform-audit] write failed:', 'db down')
    expect(capture).toHaveBeenCalledWith(err, { method: 'AUDIT', path: 'platform_audit' }, { routePath: 'audit:support.impersonate.start' }, { db })
  })

  it('passes no client when none is given, and logs a non-Error as is', async () => {
    capture.mockResolvedValue(undefined)
    await recordAuditFailure('plain', 'x.y')
    expect(console.error).toHaveBeenCalledWith('[platform-audit] write failed:', 'plain')
    expect(capture.mock.calls[0][3]).toEqual({})
  })

  it('never throws, and gives up after 500 ms', async () => {
    vi.useFakeTimers()
    capture.mockReturnValue(new Promise(() => {}))
    const p = recordAuditFailure(new Error('x'), 'a.b')
    let done = false
    void p.then(() => (done = true))
    await vi.advanceTimersByTimeAsync(499)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    capture.mockRejectedValue(new Error('capture broke'))
    await expect(recordAuditFailure(new Error('x'), 'a.b')).resolves.toBeUndefined()
  })
})

describe('audit() edges', () => {
  const ok = (data: unknown) => ({ rpc: vi.fn((..._args: unknown[]) => Promise.resolve({ data, error: null })) })

  it('reads the row from an array or an object, seq as a number', async () => {
    expect(await audit({ tenantId: null, actor: 'system', action: 'a.b' }, { enabled: true, db: ok([{ id: 7, chain_seq: '3' }]) as never })).toEqual({
      ok: true,
      id: 7,
      seq: 3,
    })
    expect(await audit({ tenantId: null, actor: 'system', action: 'a.b' }, { enabled: true, db: ok({ id: 8, chain_seq: 4 }) as never })).toEqual({
      ok: true,
      id: 8,
      seq: 4,
    })
  })

  it('a missing row or a non-numeric id is a failure, recorded', async () => {
    capture.mockResolvedValue(undefined)
    for (const data of [null, [], [{ id: '7', chain_seq: 1 }], { chain_seq: 1 }]) {
      expect(await audit({ tenantId: null, actor: 'system', action: 'a.b' }, { enabled: true, db: ok(data) as never })).toEqual({
        ok: false,
        error: 'platform_audit_append returned no row',
      })
    }
    expect(capture).toHaveBeenCalledTimes(4)
  })

  it('a database error is reported with the function name', async () => {
    capture.mockResolvedValue(undefined)
    const db = { rpc: vi.fn(() => Promise.resolve({ data: null, error: { message: 'denied' } })) }
    expect(await audit({ tenantId: null, actor: 'system', action: 'a.b' }, { enabled: true, db: db as never })).toEqual({
      ok: false,
      error: 'platform_audit_append: denied',
    })
  })

  it('uses the server client when none is given', async () => {
    const db = ok([{ id: 1, chain_seq: 1 }])
    serverClient.mockReturnValue(db)
    expect(await audit({ tenantId: UUID, actor: 'cron:nightly', action: 'a.b' }, { enabled: true })).toMatchObject({ ok: true })
    expect(db.rpc).toHaveBeenCalledWith('platform_audit_append', expect.objectContaining({ p_tenant: UUID, p_actor_kind: 'cron' }))
  })

  it('an explicit actorKind wins over the inferred one; a target with no id sends null', async () => {
    const db = ok([{ id: 1, chain_seq: 1 }])
    await audit({ tenantId: UUID, actor: 'system', actorKind: 'user', action: 'a.b', target: { table: 'members' } }, { enabled: true, db: db as never })
    expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_actor_kind: 'user', p_target_table: 'members', p_target_id: null })
  })

  it('times out after the default 2.5 s and records it', async () => {
    vi.useFakeTimers()
    capture.mockResolvedValue(undefined)
    const db = { rpc: vi.fn(() => new Promise(() => {})) }
    const p = audit({ tenantId: null, actor: 'system', action: 'a.b' }, { enabled: true, db: db as never })
    let res: unknown
    void p.then((r) => (res = r))
    await vi.advanceTimersByTimeAsync(2499)
    expect(res).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(res).toEqual({ ok: false, error: 'platform audit write timed out after 2500 ms' })
  })

  it('opts.enabled false wins over the flag', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    const db = ok([{ id: 1, chain_seq: 1 }])
    expect(await audit({ tenantId: null, actor: 'system', action: 'a.b' }, { enabled: false, db: db as never })).toEqual({ ok: false, skipped: 'disabled' })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(await audit({ tenantId: null, actor: 'system', action: 'a.b' }, { db: db as never })).toMatchObject({ ok: true })
    vi.unstubAllEnvs()
  })
})

describe('verification helpers', () => {
  it('canonicalTimestamp refuses an unreadable time, naming it', () => {
    expect(() => canonicalTimestamp('not a date')).toThrow('unreadable occurred_at: not a date')
  })

  it('byteaHex: null/undefined → null, lower-cases, refuses non-hex, accepts empty', () => {
    expect(byteaHex(null)).toBeNull()
    expect(byteaHex(undefined)).toBeNull()
    expect(byteaHex('\\xABcd')).toBe('abcd')
    expect(byteaHex('ABCD')).toBe('abcd')
    expect(byteaHex('')).toBe('')
    expect(() => byteaHex('\\xzz')).toThrow('unreadable bytea value')
    expect(() => byteaHex('ab cd')).toThrow('unreadable bytea value')
    expect(() => byteaHex('abg')).toThrow('unreadable bytea value')
  })

  it('rowHash with an empty-string prev is the genesis hash', () => {
    expect(rowHash('', 'x')).toBe(rowHash(null, 'x'))
  })

  function row(seq: number, prev: string | null) {
    const base = {
      id: seq,
      tenant_id: UUID,
      chain_seq: seq,
      actor: 'system',
      actor_kind: 'system',
      action: 'a.b',
      target_table: null,
      target_id: null,
      reason: null,
      metadata_text: '{}',
      occurred_at: '2026-11-04T10:00:00Z',
    }
    const hash = rowHash(prev, canonicalRow(base))
    return { ...base, prev_hash: prev, hash }
  }

  it('checkRows reports the problem, the bad row and the head before it', () => {
    const r1 = row(1, null)
    const r2 = row(2, r1.hash)
    expect(checkRows([r1, { ...r2, chain_seq: 3 }])).toEqual({
      ok: false,
      head: { seq: 1, hash: r1.hash },
      checked: 2,
      firstBad: { id: 2, seq: 3, problem: 'sequence gap' },
    })
    expect(checkRows([r1, { ...r2, prev_hash: null }])).toMatchObject({
      checked: 2,
      firstBad: { id: 2, seq: 2, problem: 'prev_hash does not match the previous row' },
    })
    expect(checkRows([r1, { ...r2, action: 'a.c' }])).toMatchObject({
      firstBad: { problem: 'hash does not match the row' },
    })
    expect(checkRows([r1, r2])).toEqual({ ok: true, head: { seq: 2, hash: r2.hash }, checked: 2 })
  })

  function readDb(result: { data: unknown; error: { message: string } | null }) {
    const calls: unknown[][] = []
    const q: Record<string, (...a: unknown[]) => unknown> = {}
    for (const m of ['select', 'is', 'eq', 'gt', 'order']) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q)
    q.limit = (...a: unknown[]) => (calls.push(['limit', ...a]), Promise.resolve(result))
    return { client: { from: (t: string) => (calls.push(['from', t]), q) } as never, calls }
  }

  it('verifyChain reads in chain order with the default page size and the server client', async () => {
    const { client, calls } = readDb({ data: [], error: null })
    serverClient.mockReturnValue(client)
    expect(await verifyChain(UUID)).toEqual({ ok: true, tenantId: UUID, checked: 0, head: { seq: 0, hash: null } })
    expect(calls).toEqual([
      ['from', 'platform_audit_events'],
      ['select', VERIFY_COLUMNS],
      ['eq', 'tenant_id', UUID],
      ['gt', 'chain_seq', 0],
      ['order', 'chain_seq', { ascending: true }],
      ['limit', 1000],
    ])
  })

  it('verifyChain treats null data as an empty page, and names a read failure', async () => {
    expect(await verifyChain(null, { db: readDb({ data: null, error: null }).client })).toMatchObject({ ok: true, checked: 0 })
    await expect(verifyChain(null, { db: readDb({ data: null, error: { message: 'nope' } }).client })).rejects.toThrow(
      'platform audit read failed: nope',
    )
  })

  it('checkRecordedHeads reads one row per head, with the server client by default', async () => {
    const { client, calls } = readDb({ data: [{ chain_seq: 5, hash: '\\xAB' }], error: null })
    serverClient.mockReturnValue(client)
    expect(await checkRecordedHeads([{ tenantId: null, seq: 5, hash: 'AB' }])).toEqual({ ok: true, problems: [] })
    expect(calls).toEqual([
      ['from', 'platform_audit_events'],
      ['select', 'chain_seq, hash'],
      ['is', 'tenant_id', null],
      ['eq', 'chain_seq', 5],
      ['limit', 1],
    ])
  })

  it('checkRecordedHeads names the chain and the problem', async () => {
    expect(await checkRecordedHeads([{ tenantId: null, seq: 5, hash: 'ab' }], { db: readDb({ data: null, error: null }).client })).toEqual({
      ok: false,
      problems: ['platform: recorded head 5 is missing (rows were removed from the end of the chain)'],
    })
    expect(
      await checkRecordedHeads([{ tenantId: UUID, seq: 5, hash: 'ab' }], { db: readDb({ data: [{ chain_seq: 5, hash: 'cd' }], error: null }).client }),
    ).toEqual({ ok: false, problems: [`${UUID}: row 5 no longer has its recorded hash (the chain was rewritten)`] })
    await expect(
      checkRecordedHeads([{ tenantId: UUID, seq: 1, hash: 'ab' }], { db: readDb({ data: null, error: { message: 'x' } }).client }),
    ).rejects.toThrow('platform audit read failed: x')
  })
})
