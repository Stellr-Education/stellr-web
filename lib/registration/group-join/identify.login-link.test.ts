import { beforeEach, describe, expect, it, vi } from 'vitest'

// Registration identity hardening: the join link mints a sign-in ticket for a
// brand-new person and then links the new login to their member row only if the
// row has none. When that guarded link is refused (the row got a login after the
// ticket was minted) or fails, the ticket must not go out, and it is revoked.

const h = vi.hoisted(() => ({
  provision: vi.fn(),
  withdraw: vi.fn(async () => {}),
  linkResult: { count: 1 as number | null, error: null as unknown },
  updates: [] as { payload: unknown; options: unknown; filters: unknown[][] }[],
}))

vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: async () => 'm-new' }))
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
  h.withdraw.mockClear()
  h.linkResult = { count: 1, error: null }
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

  it('withholds and revokes the ticket when the row already had a login (the link changed no row)', async () => {
    h.linkResult = { count: 0, error: null }
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
})
