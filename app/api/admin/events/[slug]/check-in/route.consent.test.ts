// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S5 CONSENT (c), draft wave 8 slice 8 (defaults WD-6, BF-66): at the desk, a tenant
// event's participant whose parent or guardian has not signed the consent form is a
// failed scan. Every desk path (manual, group, scan) asks before it writes, writes
// nothing, and answers with the A16 refusal; the trigger stays the backstop. The poll
// marks such a participant for the desk list and the group sheet. A Stellr event has
// no consent rows, and its poll is byte-for-byte what it was.

type Filter = [op: string, column: string, value: unknown]
interface Call {
  table: string
  op: 'select' | 'update'
  values?: Record<string, unknown>
  filters: Filter[]
}
type ConsentRow = { participant_id: string; registration_id: string; status: 'pending' | 'signed' | 'declined' | 'expired' | 'settled' }

const OWNER = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  consents: [] as ConsentRow[],
  consentReadFails: false,
  updateError: null as { code: string; message: string } | null,
  regs: [] as unknown[],
  access: { ok: true, userId: 'clerk-admin', isAdmin: true, assignedSlugs: null } as Record<string, unknown>,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  mirrored: [] as string[],
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => {
    h.afters.push(task)
  },
}))
vi.mock('@/lib/audit/platform', async (orig) => ({
  ...(await orig<typeof import('@/lib/audit/platform')>()),
  audit: async (input: Record<string, unknown>) => {
    h.audits.push(input)
    return { ok: true, id: h.audits.length, chainSeq: h.audits.length }
  },
}))
vi.mock('@/lib/events/mirror', () => ({
  getMirroredEvent: async (slug: string) => {
    h.mirrored.push(slug)
    return { slug, tenant_id: OWNER }
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk-admin' }) }))
// C19c: the route asks lib/authz requireEventRoute; it answers for the caller h.access describes.
vi.mock('@/lib/authz', async () => {
  const { eventRouteFromAccess } = await import('@/test/fixtures/event-route')
  return {
    requireEventRoute: async (slug: string) => {
      if (h.access.throws) throw new Error('auth backend down')
      return eventRouteFromAccess(slug, h.access as never)
    },
  }
})
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ setting: 'in_person', date: '2027-03-06' }) }))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ setting: 'in_person', date: '2027-03-06' }) }))
vi.mock('@/lib/check-in-banner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/check-in-banner')>()),
  loadOpenCheckIns: async () => [],
}))
vi.mock('@/lib/check-in-crew', () => ({
  writeCrewCheckIn: async () => ({ ok: true }),
  loadCrewCheckIns: async () => new Map(),
  loadDeskCrew: async () => [],
}))

function respond(call: Call, single: boolean): { data: unknown; error: unknown } {
  const filter = (op: string, column: string) => call.filters.find((f) => f[0] === op && f[1] === column)?.[2]
  if (call.op === 'update') return { data: null, error: h.updateError }
  if (call.table === 'tenant_guardian_consents') {
    if (h.consentReadFails) return { data: null, error: { message: 'timeout' } }
    const [, column, ids] = call.filters.find((f) => f[0] === 'in') ?? []
    // `.not('status', 'in', '(a,b)')` is recorded as PostgREST sends it: `in.(a,b)`.
    const notStatus = filter('not', 'status') as string | undefined
    if (notStatus !== undefined && !notStatus.startsWith('in.(')) throw new Error(`mock supports not.in only, got not.${notStatus}`)
    const excluded = notStatus ? notStatus.slice('in.('.length, -1).split(',') : []
    const rows = h.consents.filter((r) => (ids as string[]).includes(r[column as keyof ConsentRow]) && !excluded.includes(r.status))
    return { data: rows.map((r) => ({ participant_id: r.participant_id })), error: null }
  }
  if (call.table === 'participants') {
    const ids = (filter('in', 'id') as string[] | undefined) ?? [filter('eq', 'id') as string]
    const rows = ids.map((id) => ({ id, checked_in_at: null }))
    return { data: single ? rows[0] : rows, error: null }
  }
  if (call.table === 'registrations') return { data: h.regs, error: null }
  if (call.table === 'event_settings') return { data: { check_in_token: 'placeholder-token', check_in_open: true, resources_url: null }, error: null }
  return { data: single ? null : [], error: null }
}

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] }
      const add = (op: string) => (column: string, value?: unknown) => {
        call.filters.push([op, column, value])
        return chain
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (values: Record<string, unknown>) => {
          call.op = 'update'
          call.values = values
          return chain
        },
        eq: add('eq'),
        neq: add('neq'),
        in: add('in'),
        is: add('is'),
        not: (column: string, op: string, value: unknown) => {
          call.filters.push(['not', column, `${op}.${value === null ? 'null' : String(value)}`])
          return chain
        },
        upsert: async () => ({ error: null }),
        maybeSingle: async () => {
          h.calls.push(call)
          return respond(call, true)
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          h.calls.push(call)
          return Promise.resolve(respond(call, false)).then(resolve, reject)
        },
      }
      return chain
    },
  }),
}))

const { GET, POST } = await import('./route')
const { signCheckInCode } = await import('@/lib/check-in-codes')

const MINOR = '11111111-1111-4111-8111-111111111111'
const PEER = '22222222-2222-4222-8222-222222222222'
const REG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SLUG = 'tenant-event-2027'

const REFUSAL_BODY = {
  code: 'guardian_consent_pending',
  error: "Not checked in: a parent or guardian hasn't signed the consent form for this participant yet. In a group, check the others in one at a time.",
}

function post(body: unknown, slug = SLUG) {
  return POST(
    new Request(`https://app.test/api/admin/events/${slug}/check-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) }
  )
}
const get = (slug = SLUG) => GET(new Request(`https://app.test/api/admin/events/${slug}/check-in`), { params: Promise.resolve({ slug }) })
const updates = () => h.calls.filter((c) => c.op === 'update')
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}

// Built in the test, after beforeEach sets the code secret.
const PATHS: [string, () => Record<string, unknown>][] = [
  ['manual', () => ({ action: 'manual', participantId: MINOR })],
  ['group_check_in', () => ({ action: 'group_check_in', participantIds: [MINOR, PEER] })],
  ['scan', () => ({ action: 'scan', code: signCheckInCode(SLUG, 'p', MINOR) })],
]

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('SURVEY_TOKEN_SECRET', 's'.repeat(40))
  h.calls = []
  h.consents = []
  h.consentReadFails = false
  h.updateError = null
  h.regs = []
  h.access = { ok: true, userId: 'clerk-admin', isAdmin: true, assignedSlugs: null }
  h.afters = []
  h.audits = []
  h.mirrored = []
})
afterEach(() => vi.unstubAllEnvs())

describe('every desk path × every consent state', () => {
  const STATES = ['pending', 'declined', 'expired'] as const

  for (const [path, body] of PATHS) {
    it.each(STATES)(`${path}: consent %s is a failed scan, nothing written, the A16 refusal`, async (status) => {
      h.consents = [{ participant_id: MINOR, registration_id: REG, status }]
      const res = await post(body())
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual(REFUSAL_BODY)
      expect(updates()).toHaveLength(0)
    })

    it.each(['signed', 'settled'] as const)(`${path}: consent %s checks in as before`, async (status) => {
      h.consents = [{ participant_id: MINOR, registration_id: REG, status }]
      const res = await post(body())
      expect(res.status).toBe(200)
      expect(updates()).toHaveLength(1)
      expect(updates()[0].values).toMatchObject({ check_in_method: 'manual' })
    })

    it(`${path}: no consent row (a Stellr event, or an adult) checks in as before`, async () => {
      const res = await post(body())
      expect(res.status).toBe(200)
      expect(updates()).toHaveLength(1)
    })

    it(`${path}: the consent read failed, so the trigger decides, and its refusal is the same answer`, async () => {
      h.consentReadFails = true
      h.updateError = { code: '23514', message: 'guardian_consent_pending' }
      const res = await post(body())
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual(REFUSAL_BODY)
    })
  }

  it('group: one pending minor refuses the whole group (BF-66); the others are not written either', async () => {
    h.consents = [{ participant_id: MINOR, registration_id: REG, status: 'pending' }]
    const res = await post({ action: 'group_check_in', participantIds: [PEER, MINOR] })
    expect(res.status).toBe(409)
    expect(updates()).toHaveLength(0)
  })

  it('group: with the pending minor unticked, the rest check in', async () => {
    h.consents = [{ participant_id: MINOR, registration_id: REG, status: 'pending' }]
    const res = await post({ action: 'group_check_in', participantIds: [PEER] })
    expect(res.status).toBe(200)
    expect(updates()[0].filters).toContainEqual(['in', 'id', [PEER]])
  })

  it('undo is never refused: taking someone out is not a check-in', async () => {
    h.consents = [{ participant_id: MINOR, registration_id: REG, status: 'pending' }]
    expect((await post({ action: 'undo', participantId: MINOR })).status).toBe(200)
    expect((await post({ action: 'group_undo', participantIds: [MINOR, PEER] })).status).toBe(200)
    expect(h.calls.filter((c) => c.table === 'tenant_guardian_consents')).toHaveLength(0)
  })

  it('group: a settled member (a date-of-birth correction to 18 or over) does not refuse the group', async () => {
    h.consents = [{ participant_id: MINOR, registration_id: REG, status: 'settled' }]
    const res = await post({ action: 'group_check_in', participantIds: [PEER, MINOR] })
    expect(res.status).toBe(200)
    expect(updates()).toHaveLength(1)
  })

  it("the consent read asks by participant, for rows that hold only (the trigger's NOT IN list)", async () => {
    await post({ action: 'manual', participantId: MINOR })
    const read = h.calls.find((c) => c.table === 'tenant_guardian_consents')!
    expect(read.filters).toEqual([
      ['in', 'participant_id', [MINOR]],
      ['not', 'status', 'in.(signed,settled)'],
    ])
  })
})

describe('the poll: the desk marker (WD-6)', () => {
  const participant = (id: string, first: string) => ({
    id,
    member_id: null,
    first_name: first,
    last_name: 'Example',
    event_role: 'participant',
    school_name: null,
    t_shirt_size: 'M',
    checked_in_at: null,
    check_in_method: null,
    merch_collected: false,
    event_companies: null,
  })
  const registration = { id: REG, type: 'group', school_name: 'A School', group_name: null, teacher_first_name: 'T', teacher_last_name: 'Example', participants: [participant(MINOR, 'Minor'), participant(PEER, 'Peer')] }

  it('marks a tenant-event participant with a pending consent row, and nobody else', async () => {
    h.regs = [registration]
    h.consents = [
      { participant_id: MINOR, registration_id: REG, status: 'pending' },
      { participant_id: PEER, registration_id: REG, status: 'signed' },
    ]
    const body = await (await get()).json()
    const byId = Object.fromEntries(body.participants.map((p: { id: string }) => [p.id, p]))
    expect(byId[MINOR].consentPending).toBe(true)
    expect('consentPending' in byId[PEER]).toBe(false)
    const read = h.calls.find((c) => c.table === 'tenant_guardian_consents')!
    expect(read.filters).toEqual([
      ['in', 'registration_id', [REG]],
      ['not', 'status', 'in.(signed,settled)'],
    ])
  })

  it('a settled consent gets no marker', async () => {
    h.regs = [registration]
    h.consents = [
      { participant_id: MINOR, registration_id: REG, status: 'settled' },
      { participant_id: PEER, registration_id: REG, status: 'signed' },
    ]
    const body = await (await get()).json()
    for (const p of body.participants as Array<Record<string, unknown>>) expect('consentPending' in p).toBe(false)
  })

  it('a Stellr event (no consent rows): the poll is byte-identical to the pre-consent shape', async () => {
    h.regs = [registration]
    const text = await (await get('stellr-event')).text()
    const before = {
      checkInOpen: true,
      checkInToken: 'placeholder-token',
      resourcesUrl: null,
      participants: [MINOR, PEER].map((id, i) => ({
        id,
        registrationId: REG,
        firstName: i === 0 ? 'Minor' : 'Peer',
        lastName: 'Example',
        eventRole: 'participant',
        schoolName: null,
        shirtSize: 'M',
        checkedInAt: null,
        checkInMethod: null,
        company: null,
        merch: [],
        merchCollected: false,
      })),
      groups: [{ id: REG, label: 'A School', teacher: 'T Example' }],
      crewCheckIns: {},
      bannerTarget: false,
      otherOpen: [],
    }
    expect(text).toBe(JSON.stringify(before))
    expect(text).not.toContain('consent')
  })

  it('a failed consent read marks nobody and keeps the poll working', async () => {
    h.regs = [registration]
    h.consents = [{ participant_id: MINOR, registration_id: REG, status: 'pending' }]
    h.consentReadFails = true
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('consentPending')
  })

  it('an event with no registrations asks nothing', async () => {
    await get()
    expect(h.calls.filter((c) => c.table === 'tenant_guardian_consents')).toHaveLength(0)
  })
})

describe('platform audit: snake_case keys, placed by the verified slug', () => {
  beforeEach(() => vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true'))

  it('a refusal is a 4xx and, as every refusal, records no event', async () => {
    h.consents = [{ participant_id: MINOR, registration_id: REG, status: 'pending' }]
    expect((await post({ action: 'manual', participantId: MINOR })).status).toBe(409)
    await flush()
    expect(h.audits).toEqual([])
  })

  it('every metadata key is snake_case', async () => {
    await post({ action: 'group_check_in', participantIds: [MINOR, PEER] })
    await post({ action: 'open' })
    await flush()
    expect(h.audits).toHaveLength(2)
    for (const a of h.audits) {
      for (const key of Object.keys(a.metadata as object)) expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
    }
    expect(h.audits[1].metadata).toMatchObject({ desk_action: 'open', closed_count: 0 })
  })

  it('the chain is the slug the access check passed for, read once from the mirror', async () => {
    await post({ action: 'manual', participantId: MINOR })
    await flush()
    expect(h.mirrored).toEqual([SLUG])
  })

  it('the chain is never the raw URL slug: a request that failed before the access check is unplaced', async () => {
    h.access = { throws: true }
    // withAudit records the failure (status 500) and rethrows it.
    await expect(post({ action: 'manual', participantId: MINOR })).rejects.toThrow('auth backend down')
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ tenantId: null, metadata: { tenant_unresolved: true, status: 500 } })
    expect(JSON.stringify(h.audits)).not.toContain(SLUG)
    expect(h.mirrored).toEqual([])
  })
})
