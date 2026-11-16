import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 C20a: a storefront or reship order names no event, so the S3 trigger would log
// `no_key` for it, and derivation enforce would refuse it. createPendingOrder writes
// Stellr's tenant_id itself (the store is Stellr-only in release 1). In log mode the
// trigger keeps a supplied tenant_id that agrees with the derived one, so the value is
// today's. Items are store_order_items, whose tenant the parent trigger copies.

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ inserts: [] as { table: string; row: unknown }[] }))

function from(table: string) {
  const q: Record<string, unknown> = {}
  q.insert = (row: unknown) => {
    h.inserts.push({ table, row })
    return q
  }
  q.select = () => q
  q.single = async () => ({ data: { id: 'order-1' }, error: null })
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
  return q
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/email', () => ({ sendEmail: async () => {} }))
vi.mock('./printful', () => ({ printfulEnabled: () => false, createOrder: async () => ({ id: 'pf' }) }))

import { createPendingOrder } from './orders'

const line = { variantId: 'v1', sku: 'TEE-M', name: 'Tee — M', qty: 2, baseCents: 2500, unitCents: 2000 }

beforeEach(() => {
  h.inserts = []
})

describe('createPendingOrder: explicit tenant_id (S5 C20a)', () => {
  it("writes a storefront order with Stellr's tenant_id, and returns as before", async () => {
    const out = await createPendingOrder({ memberId: 'm1', email: 'buyer@example.test', lines: [line] })
    expect(out).toEqual({ orderId: 'order-1', subtotalCents: 4000 })
    const order = h.inserts.find((i) => i.table === 'store_orders')
    expect(order?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, channel: 'storefront', status: 'pending', subtotal_cents: 4000, discount_cents: 1000 })
  })

  it("writes a reship order with Stellr's tenant_id", async () => {
    await createPendingOrder({ memberId: 'm1', email: null, channel: 'reship', sourceOrderId: 'order-0', lines: [{ ...line, baseCents: 0, unitCents: 0 }] })
    const order = h.inserts.find((i) => i.table === 'store_orders')
    expect(order?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, channel: 'reship', source_order_id: 'order-0' })
  })

  it('leaves the items without a tenant_id: the parent trigger copies the order’s', async () => {
    await createPendingOrder({ memberId: null, email: null, lines: [line] })
    const items = h.inserts.find((i) => i.table === 'store_order_items')?.row as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(items[0]).not.toHaveProperty('tenant_id')
  })
})
