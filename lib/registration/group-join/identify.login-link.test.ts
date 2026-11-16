import { beforeEach, describe, expect, it, vi } from 'vitest'

// Registration identity hardening: the join link mints a sign-in ticket for a
// brand-new person and then links the new login to their member row only if the
// row has none. When that guarded link is refused (the row got a login after the
// ticket was minted) or fails, the ticket must not go out, and it is revoked.

const h = vi.hoisted(() => ({
  provision: vi.fn(),
  withdraw: vi.fn(async () => {}),
  linkResult: { count: 1 as number | null, error: null as unknown },
  readBack: { data: null as { clerk_user_id: string | null } | null, error: null as unknown },
  reads: [] as { columns: unknown; filters: unknown[][] }[],
  outcome: { member: 'm-new' as string | null, inserted: true },
  updates: [] as { payload: unknown; options: unknown; filters: unknown[][] }[],
}))

vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/member-sync', () => ({ upsertMemberOutcome: async () => h.outcome }))
vi.mock('@/lib/pending-consent', () => ({ childAwaitingConsentBlock: async () => null }))
vi.mock('../member-on-file', () => ({
  SIGN_IN_REQUIRED: 'sign_in_required',
  findMemberOnFile: async () => ({ ok: true, onFile: false }),
}))
vi.mock('./parse', () => ({
  personFromDetails: () => ({
    ok: true,
    person: { email: 'new.joiner@example.test', school_email: null, first_name: 'New', last_name: 'Joiner', date_of_birth: '1990-01-01' },
  }),
  personFromProfile: vi.fn(),
}))

const { identifyNewParticipant } = await import('./identify')

function db() {
  return {
    from() {
      const call = { payload: null as unknown, options: null as unknown, filters: [] as unknown[][] }
      const chain: Record<string, unknown> = {
        update: (p: unknown, o?: unknown) => { call.payload = p; call.options = o; h.updates.push(call); return chain },
        select: (columns: unknown) => {
          const read = { columns, filters: call.filters }
          h.reads.push(read)
          return chain
        },
        maybeSingle: () => Promise.resolve(h.readBack),
        eq: (...a: unknown[]) => { call.filters.push(['eq', ...a]); return chain },
        is: (...a: unknown[]) => { call.filters.push(['is', ...a]); return chain },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, ...h.linkResult }).then(ok),
      }
      return chain
    },
  } as never
}

const owner = {
  eligibility: {},
  confirm: async () => ({ ok: true, context: { eligibility: { isPlatformOwner: true } } }),
} as never

beforeEach(() => {
  h.updates.length = 0
  h.reads.length = 0
  h.withdraw.mockClear()
  h.provision.mockReset()
  h.linkResult = { count: 1, error: null }
  h.readBack = { data: null, error: null }
  h.outcome = { member: 'm-new', inserted: true }
  h.provision.mockResolvedValue({ clerkUserId: 'user_new', signInToken: 'tkt_minted', created: true, withdraw: h.withdraw })
})

async function join() {
  const r = await identifyNewParticipant(db(), {}, owner)
  if (!r.ok) throw new Error('refused')
  return r.joiner
}

describe('identifyNewParticipant: the login link and the minted ticket', () => {
  it('hands out the ticket when the guarded link landed on the new row', async () => {
    const joiner = await join()
    expect(joiner.signInToken).toBe('tkt_minted')
    expect(h.withdraw).not.toHaveBeenCalled()
    expect(h.updates[0].filters).toContainEqual(['is', 'clerk_user_id', null])
  })

  it('withholds and revokes the ticket when the row already had another login (the link changed no row)', async () => {
    h.linkResult = { count: 0, error: null }
    h.readBack = { data: { clerk_user_id: 'user_someone_else' }, error: null }
    const joiner = await join()
    expect(joiner.signInToken).toBeNull()
    expect(joiner.memberId).toBe('m-new')
    expect(h.withdraw).toHaveBeenCalledOnce()
  })

  it('withholds and revokes the ticket when the link write failed', async () => {
    h.linkResult = { count: null, error: { message: 'down' } }
    const joiner = await join()
    expect(joiner.signInToken).toBeNull()
    expect(h.withdraw).toHaveBeenCalledOnce()
  })

  it('asks the database how many rows the link changed', async () => {
    await join()
    expect(h.updates[0].options).toEqual({ count: 'exact' })
  })

  it('hands out the ticket when the webhook linked this same login first (the link changed no row)', async () => {
    h.linkResult = { count: 0, error: null }
    h.readBack = { data: { clerk_user_id: 'user_new' }, error: null }
    const joiner = await join()
    expect(joiner.signInToken).toBe('tkt_minted')
    expect(h.withdraw).not.toHaveBeenCalled()
    expect(h.reads).toHaveLength(1)
    expect(h.reads[0].columns).toBe('clerk_user_id')
    expect(h.reads[0].filters).toContainEqual(['eq', 'id', 'm-new'])
  })

  it('withholds and revokes the ticket when the read-back after a refused link fails', async () => {
    h.linkResult = { count: 0, error: null }
    h.readBack = { data: null, error: { message: 'down' } }
    const joiner = await join()
    expect(joiner.signInToken).toBeNull()
    expect(h.withdraw).toHaveBeenCalledOnce()
  })

  it('does not read the row back when the link landed', async () => {
    await join()
    expect(h.reads).toHaveLength(0)
  })
})

describe('identifyNewParticipant: a request that did not insert the member row', () => {
  it('runs no new-member steps when it lost the insert race to another request', async () => {
    h.outcome = { member: 'm-x', inserted: false }
    // What provisioning does for an existing member (lib/clerk-provisioning).
    h.provision.mockResolvedValue({ clerkUserId: '', signInToken: null, created: false })
    const joiner = await join()
    expect(joiner.memberId).toBe('m-x')
    expect(joiner.signInToken).toBeNull()
    expect(h.provision).toHaveBeenCalledOnce()
    expect(h.provision.mock.calls[0][3]).toMatchObject({ memberIsNew: false })
    expect(h.updates).toHaveLength(0)
  })

  it('tells provisioning the member is new when this request inserted the row', async () => {
    h.provision.mockResolvedValue({ clerkUserId: 'user_new', signInToken: 'tkt_minted', created: true, withdraw: h.withdraw })
    await join()
    expect(h.provision.mock.calls[0][3]).toMatchObject({ memberIsNew: true })
  })
})
