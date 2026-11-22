// @vitest-environment node
import Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { devPriceMap, priceSwappingHttpClient, swapDeep, swapIds } from './stripe-dev-prices'

const LIVE = 'price_1LiveAAA'
const TEST = 'price_1TestBBB'
const MAP_JSON = JSON.stringify({ [LIVE]: TEST })
const env = (over: Record<string, string | undefined>) => ({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_DEV_PRICE_MAP: MAP_JSON, ...over }) as NodeJS.ProcessEnv

afterEach(() => vi.unstubAllEnvs())

describe('devPriceMap', () => {
  it('is on with a test key, outside production, and a map', () => {
    expect(devPriceMap(env({}))?.get(LIVE)).toBe(TEST)
    expect(devPriceMap(env({ STRIPE_SECRET_KEY: 'rk_test_y' }))?.get(LIVE)).toBe(TEST)
  })

  it('stays off with a live key, in production, or with no map', () => {
    expect(devPriceMap(env({ STRIPE_SECRET_KEY: 'sk_live_x' }))).toBeNull()
    expect(devPriceMap(env({ STRIPE_SECRET_KEY: undefined }))).toBeNull()
    expect(devPriceMap(env({ STRIPE_DEV_PRICE_MAP: undefined }))).toBeNull()
    expect(devPriceMap(env({ STRIPE_DEV_PRICE_MAP: '  ' }))).toBeNull()
    expect(devPriceMap(env({ STRIPE_DEV_PRICE_MAP: '{}' }))).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    expect(devPriceMap(env({}))).toBeNull()
  })

  it('throws on a map that is set but wrong, rather than read it as no map', () => {
    expect(() => devPriceMap(env({ STRIPE_DEV_PRICE_MAP: 'price_a=price_b' }))).toThrow(/not valid JSON/)
    expect(() => devPriceMap(env({ STRIPE_DEV_PRICE_MAP: '["price_a"]' }))).toThrow(/JSON object/)
    expect(() => devPriceMap(env({ STRIPE_DEV_PRICE_MAP: '{"price_a":"prod_b"}' }))).toThrow(/different price_ id/)
    expect(() => devPriceMap(env({ STRIPE_DEV_PRICE_MAP: '{"price_a":"price_a"}' }))).toThrow(/different price_ id/)
    expect(() => devPriceMap(env({ STRIPE_DEV_PRICE_MAP: '{"price_a":"price_c","price_b":"price_c"}' }))).toThrow(/same test price/)
  })
})

describe('swapIds and swapDeep', () => {
  const map = new Map([[LIVE, TEST]])

  it('swaps whole ids in a path or a form body, never part of a longer id', () => {
    expect(swapIds(`/v1/prices/${LIVE}`, map)).toBe(`/v1/prices/${TEST}`)
    expect(swapIds(`line_items[0][price]=${LIVE}&line_items[0][quantity]=1`, map)).toBe(`line_items[0][price]=${TEST}&line_items[0][quantity]=1`)
    expect(swapIds(`price=${LIVE}X`, map)).toBe(`price=${LIVE}X`)
    expect(swapIds('', map)).toBe('')
  })

  it('swaps only strings that are exactly an id, at any depth', () => {
    const back = new Map([[TEST, LIVE]])
    expect(swapDeep({ id: 'ii_1', price: { id: TEST, unit_amount: 100 }, lines: [{ price: { id: TEST } }], note: `x ${TEST}` }, back))
      .toEqual({ id: 'ii_1', price: { id: LIVE, unit_amount: 100 }, lines: [{ price: { id: LIVE } }], note: `x ${TEST}` })
    expect(swapDeep(null, back)).toBeNull()
    expect(swapDeep(3, back)).toBe(3)
  })
})

describe('priceSwappingHttpClient through the Stripe client', () => {
  function fakeHttp(respond: (path: string, body: string) => unknown) {
    const seen: { path: string; body: string }[] = []
    const client = {
      getClientName: () => 'fake',
      makeRequest: async (_h: string, _p: string, path: string, _m: string, _hd: unknown, body: string) => {
        seen.push({ path, body })
        const json = respond(path, body)
        return {
          getStatusCode: () => 200,
          getHeaders: () => ({ 'request-id': 'req_1' }),
          getRawResponse: () => ({}),
          toStream: () => null,
          toJSON: async () => json,
        }
      },
    }
    return { client: client as unknown as NonNullable<Stripe.StripeConfig['httpClient']>, seen }
  }

  it('sends the test id and hands back the live id, for a retrieve and a Checkout create', async () => {
    const http = fakeHttp((path) =>
      path.startsWith('/v1/prices/')
        ? { id: TEST, object: 'price', unit_amount: 12_500, currency: 'usd' }
        : { id: 'cs_1', object: 'checkout.session', line_items: { data: [{ price: { id: TEST } }] } },
    )
    const stripe = new Stripe('sk_test_x', { httpClient: priceSwappingHttpClient(http.client, new Map([[LIVE, TEST]])), maxNetworkRetries: 0 })

    const price = await stripe.prices.retrieve(LIVE)
    expect(http.seen[0].path).toContain(`/v1/prices/${TEST}`)
    expect(price.id).toBe(LIVE)
    expect(price.unit_amount).toBe(12_500)

    const session = await stripe.checkout.sessions.create({ mode: 'payment', line_items: [{ price: LIVE, quantity: 1 }], success_url: 'https://x.test/ok' })
    expect(decodeURIComponent(http.seen[1].body)).toContain(`line_items[0][price]=${TEST}`)
    expect(decodeURIComponent(http.seen[1].body)).not.toContain(LIVE)
    expect((session as unknown as { line_items: { data: { price: { id: string } }[] } }).line_items.data[0].price.id).toBe(LIVE)
  })
})
