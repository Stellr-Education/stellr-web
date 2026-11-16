// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The store catalogue (GATE-AUDIT remainder, critique item 2): every write records one
// platform audit event on Stellr's chain. The product, variant or discount row is the
// target; field names, ids, counts and enums the metadata. Never a name, SKU or price label.

const PRODUCT = '11111111-1111-4111-8111-111111111111'
const VARIANT = '22222222-2222-4222-8222-222222222222'
const DISCOUNT = '33333333-3333-4333-8333-333333333333'
const CALLER = 'user_staffplaceholder'

const h = vi.hoisted(() => ({
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  fail: false,
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
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: CALLER, sessionClaims: {} }) }))
vi.mock('@/lib/store/auth', () => ({ canManageStoreCatalog: async () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
const maybeFail = async <T,>(v: T): Promise<T> => {
  if (h.fail) throw new Error('boom')
  return v
}
vi.mock('@/lib/store/discounts', () => ({
  listTierDiscounts: async () => [],
  listEventDiscounts: async () => [],
  upsertTierDiscount: () => maybeFail(undefined),
  upsertEventDiscount: () => maybeFail(undefined),
  deleteDiscount: () => maybeFail(undefined),
}))
vi.mock('@/lib/store/products', () => ({
  listProducts: async () => [],
  getProduct: async () => null,
  createProduct: () => maybeFail({ id: PRODUCT }),
  updateProduct: () => maybeFail(undefined),
  archiveProduct: () => maybeFail(undefined),
  createVariant: () => maybeFail({ id: VARIANT }),
  updateVariant: () => maybeFail(undefined),
  deleteVariant: () => maybeFail(undefined),
  syncFromPrintful: () => maybeFail({ imported: 6 }),
}))
vi.mock('@/lib/store/printful', () => ({ printfulEnabled: () => true }))

const discounts = await import('./discounts/route')
const { POST: createProduct } = await import('./products/route')
const product = await import('./products/[id]/route')
const { POST: printfulSync } = await import('./products/[id]/sync/route')
const variants = await import('./products/[id]/variants/route')

const send = (method: string, path: string, body?: unknown) =>
  new Request(`https://app.test/api/admin/store${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const ctx = { params: Promise.resolve({ id: PRODUCT }) }
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const recorded = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))
const stellr = { tenantId: STELLR_TENANT_ID, actor: CALLER }

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.audits = []
  h.fail = false
})

describe('store: products and variants', () => {
  it('each write names its row; an edit names the fields sent, never their values', async () => {
    expect((await createProduct(send('POST', '/products', { name: 'Placeholder Tee', description: 'Soft' }))).status).toBe(200)
    expect((await product.PATCH(send('PATCH', `/products/${PRODUCT}`, { name: 'Renamed Tee', price_cents: 1200 }), ctx)).status).toBe(200)
    expect((await product.DELETE(send('DELETE', `/products/${PRODUCT}`), ctx)).status).toBe(200)
    expect((await printfulSync(send('POST', `/products/${PRODUCT}/sync`, { printfulSyncProductId: 4242 }), ctx)).status).toBe(200)
    expect((await variants.POST(send('POST', `/products/${PRODUCT}/variants`, { sku: 'SKU-PLACEHOLDER', market_price_cents: 1500 }), ctx)).status).toBe(200)
    expect((await variants.PATCH(send('PATCH', `/products/${PRODUCT}/variants`, { variantId: VARIANT, label: 'Large Placeholder' }))).status).toBe(200)
    expect((await variants.DELETE(send('DELETE', `/products/${PRODUCT}/variants?variantId=${VARIANT}`))).status).toBe(200)
    await flush()
    const p = { table: 'store_products', id: PRODUCT }
    const v = { table: 'store_variants', id: VARIANT }
    expect(recorded()).toEqual([
      { ...stellr, action: 'store.product.create', target: p, metadata: { status: 200 } },
      { ...stellr, action: 'store.product.update', target: p, metadata: { fields: ['name', 'price_cents'], status: 200 } },
      { ...stellr, action: 'store.product.archive', target: p, metadata: { status: 200 } },
      { ...stellr, action: 'store.product.printful_sync', target: p, metadata: { printful_product_id: 4242, imported: 6, status: 200 } },
      { ...stellr, action: 'store.variant.create', target: v, metadata: { product_id: PRODUCT, status: 200 } },
      { ...stellr, action: 'store.variant.update', target: v, metadata: { fields: ['label'], status: 200 } },
      { ...stellr, action: 'store.variant.delete', target: v, metadata: { status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Placeholder|Renamed|SKU-/)
  })

  it('a refusal (no name) records nothing; a failed write is a 500, recorded with its status', async () => {
    expect((await createProduct(send('POST', '/products', {}))).status).toBe(400)
    h.fail = true
    expect((await product.DELETE(send('DELETE', `/products/${PRODUCT}`), ctx)).status).toBe(500)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'store.product.archive', target: { table: 'store_products', id: PRODUCT }, metadata: { status: 500 } },
    ])
  })
})

describe('store: discounts', () => {
  it('a save names the table and its axis, scope and percentage; a delete names the row', async () => {
    expect((await discounts.POST(send('POST', '/discounts', { axis: 'event', scope: 'event', event_slug: 'placeholder-2026', percent_off: 15 }))).status).toBe(200)
    expect((await discounts.DELETE(send('DELETE', `/discounts?axis=tier&id=${DISCOUNT}`))).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'store.discount.save', target: { table: 'store_event_discounts', id: null }, metadata: { axis: 'event', scope: 'event', percent_off: 15, status: 200 } },
      { ...stellr, action: 'store.discount.delete', target: { table: 'store_tier_discounts', id: DISCOUNT }, metadata: { axis: 'tier', status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('placeholder-2026')
  })

  it('an unknown axis is refused and records nothing', async () => {
    expect((await discounts.POST(send('POST', '/discounts', { axis: 'sideways' }))).status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })
})
