import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 C20a: the event-merch order is the one store_orders writer with an event. The store
// is Stellr-only in release 1, so ensureEventMerchOrder reads the event's owner once,
// before the order exists, by C20c's rule (loadEventTenantId, as refuseUnlessStellrEvent): Stellr's event
// gets an order carrying Stellr's tenant_id, the value the S3 trigger derives for it
// today; another tenant's event gets no order, so no add-on is persisted or charged.

const OTHER_TENANT = '00000000-0000-4000-8000-0000000000aa'

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let inserts: { table: string; row: unknown }[]
let eventReads: unknown[]
let eventError: { message: string } | null

function from(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let inserted: Row | null = null
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      if (table === 'events') eventReads.push(v)
      filters.push((r) => r[c] === v)
      return q
    },
    not: (c: string) => (filters.push((r) => r[c] != null), q),
    limit: () => q,
    update: () => q,
    insert: (row: Row | Row[]) => {
      inserts.push({ table, row })
      if (!Array.isArray(row)) {
        inserted = { id: `${table}-new`, ...row }
        ;(tables[table] ??= []).push(inserted)
      }
      return q
    },
    single: async () => ({ data: inserted, error: null }),
    maybeSingle: async () => {
      if (table === 'events' && eventError) return { data: null, error: eventError }
      return { data: matched()[0] ?? null, error: null }
    },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: matched(), error: null }).then(resolve),
  }
  return q
}
const db = { from } as unknown as SupabaseClient

vi.mock('./pricing', () => ({ computeUnitPrice: async () => ({ unit_cents: 1500 }) }))
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn(async () => {}) }))
vi.mock('@/lib/app-errors', () => ({ reportError }))

import { ensureEventMerchOrder, EventMerchOwnerReadError, finalizeRegistrationMerch } from './event-merch'

const orderInserts = () => inserts.filter((i) => i.table === 'store_orders')

function seed(eventSlug: string, owner: string | null) {
  tables = {
    registrations: [{ id: 'reg-1', event_slug: eventSlug, teacher_member_id: 'teacher-1', teacher_email: 'teacher@example.test' }],
    participants: [{ registration_id: 'reg-1', member_id: 'student-1', t_shirt_size: 'M' }],
    events: owner ? [{ slug: eventSlug, tenant_id: owner }] : [],
    store_orders: [],
    store_order_items: [],
    event_store_offerings: [],
  }
}

beforeEach(() => {
  reportError.mockClear()
  inserts = []
  eventReads = []
  eventError = null
})

describe('ensureEventMerchOrder: explicit tenant_id (S5 C20a)', () => {
  it("writes Stellr's event's order with Stellr's tenant_id, after one events read", async () => {
    seed('stellr-comp', STELLR_TENANT_ID)
    await ensureEventMerchOrder(db, 'reg-1')
    expect(orderInserts()).toHaveLength(1)
    expect(orderInserts()[0].row).toMatchObject({
      tenant_id: STELLR_TENANT_ID,
      channel: 'event_registration',
      event_slug: 'stellr-comp',
      registration_id: 'reg-1',
      member_id: 'teacher-1',
    })
    expect(eventReads).toEqual(['stellr-comp'])
  })

  it("treats an event the mirror does not know as Stellr's", async () => {
    seed('not-mirrored', null)
    await ensureEventMerchOrder(db, 'reg-1')
    expect(orderInserts()[0]?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID })
  })

  it('reads the owner only when it creates the order', async () => {
    seed('stellr-comp', STELLR_TENANT_ID)
    tables.store_orders.push({ id: 'order-existing', registration_id: 'reg-1', channel: 'event_registration' })
    await ensureEventMerchOrder(db, 'reg-1')
    expect(orderInserts()).toEqual([])
    expect(eventReads).toEqual([])
  })

  it("creates no order for another tenant's event", async () => {
    seed('tenant-comp', OTHER_TENANT)
    await ensureEventMerchOrder(db, 'reg-1')
    expect(inserts).toEqual([])
  })

  it('fails loudly when the owner read fails, rather than answer "no order" for a transient fault', async () => {
    seed('stellr-comp', STELLR_TENANT_ID)
    eventError = { message: 'boom' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Thrown, the registration answers a 500 that its route records in app_errors.
      await expect(ensureEventMerchOrder(db, 'reg-1')).rejects.toBeInstanceOf(EventMerchOwnerReadError)
    } finally {
      err.mockRestore()
    }
    expect(inserts).toEqual([])
    // The route records it; the library does not record it a second time.
    expect(reportError).not.toHaveBeenCalled()
  })

  it('finalize never throws on a failed owner read, writes nothing, and records it in app_errors', async () => {
    seed('stellr-comp', STELLR_TENANT_ID)
    eventError = { message: 'boom' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(finalizeRegistrationMerch(db, 'reg-1')).resolves.toBeUndefined()
    } finally {
      err.mockRestore()
    }
    expect(inserts).toEqual([])
    expect(reportError).toHaveBeenCalledWith(expect.any(EventMerchOwnerReadError), expect.objectContaining({ route: 'LIB store/event-merch owner lookup' }))
  })

  it("finalize still never throws, and writes nothing for another tenant's event", async () => {
    seed('tenant-comp', OTHER_TENANT)
    await expect(finalizeRegistrationMerch(db, 'reg-1')).resolves.toBeUndefined()
    expect(inserts).toEqual([])
  })

  it("finalize writes Stellr's event's order with Stellr's tenant_id", async () => {
    seed('stellr-comp', STELLR_TENANT_ID)
    await finalizeRegistrationMerch(db, 'reg-1')
    expect(orderInserts()).toHaveLength(1)
    expect(orderInserts()[0].row).toMatchObject({ tenant_id: STELLR_TENANT_ID, event_slug: 'stellr-comp' })
  })
})
