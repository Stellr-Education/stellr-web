import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-13/PAY-15: the store-returns refund path had no test. Pin that
// an admin-approved return consults the test-key guard before issuing the Stripe
// refund (a test-mode refund settles nothing).

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  canManage: true,
  refundsCreate: vi.fn(async () => ({ id: 're_1' })),
  assertLiveCredentials: vi.fn(),
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let pendingUpdate: Row | null = null
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const run = () => {
    if (pendingUpdate) {
      for (const r of matched()) Object.assign(r, pendingUpdate)
    }
    return { data: matched(), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    update: (set: Row) => ((pendingUpdate = set), q),
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/store/auth', () => ({
  currentStoreMember: async () => ({ id: 'm1', email: 'm1@x.com' }),
  canManageStoreCatalog: async () => h.canManage,
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ refunds: { create: h.refundsCreate } }) }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_admin1' }) }))
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

import { PATCH } from './route'

function patch(body: Record<string, unknown>) {
  return PATCH(new Request('http://localhost/api/store/returns', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  h.afters.length = 0
  h.audits.length = 0
  h.canManage = true
  tables = {
    store_returns: [{ id: 'ret1', order_id: 'o1', status: 'requested' }],
    store_orders: [{ id: 'o1', stripe_payment_intent_id: 'pi_1' }],
  }
})

describe('PATCH /api/store/returns approve (PAY-15)', () => {
  it('consults the test-key guard before issuing the refund', async () => {
    const res = await patch({ returnId: 'ret1', action: 'approve' })
    const json = (await res.json()) as { ok: boolean; refundId: string }
    expect(json).toMatchObject({ ok: true, refundId: 're_1' })
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
    expect(h.refundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1' })
    expect(tables.store_orders[0].status).toBe('refunded')
  })
})

// S5 wave 9 (C7's gate): the decision on a return is audited on Stellr's chain, with the
// return as the target and which way it went; a refusal records nothing.
describe('PATCH /api/store/returns: platform audit', () => {
  const RETURN = '44444444-4444-4444-8444-444444444444'
  const ORDER = '55555555-5555-4555-8555-555555555555'
  const flush = async () => {
    for (const task of h.afters.splice(0)) await task()
  }
  beforeEach(() => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    tables = {
      store_returns: [{ id: RETURN, order_id: ORDER, status: 'requested' }],
      store_orders: [{ id: ORDER, stripe_payment_intent_id: 'pi_1' }],
    }
  })

  it('records an approval with its refund', async () => {
    await patch({ returnId: RETURN, action: 'approve' })
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({
      actor: 'user_admin1',
      action: 'store.return.decide',
      target: { table: 'store_returns', id: RETURN },
      metadata: { decision: 'approve', order_id: ORDER, refund_id: 're_1', status: 200 },
    })
  })

  it('records nothing for a refusal', async () => {
    h.canManage = false
    const res = await patch({ returnId: RETURN, action: 'deny' })
    expect(res.status).toBe(403)
    await flush()
    expect(h.audits).toEqual([])
  })
})
