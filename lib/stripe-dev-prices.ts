import type Stripe from 'stripe'
import { appEnv } from './env'

// A dev-only stand-in for the live event prices (S5 `.35`).
//
// Dev and local runs read the production Sanity dataset, whose events carry
// live-mode Stripe price ids, while they hold test-mode keys. Stripe refuses a
// live price to a test key, so no priced registration could be tried anywhere
// but production. STRIPE_DEV_PRICE_MAP pairs each live price id with a test-mode
// copy:
//
//   STRIPE_DEV_PRICE_MAP={"price_1Live…":"price_1Test…", …}
//
// The swap happens in the Stripe client's HTTP layer, so every call is covered,
// pagination included: a live id in a request path or body goes out as its test
// copy, and a test id in a response comes back as the live id. The code above
// only ever sees live ids, so comparisons with an event's stripePriceId (refund
// fee lines, scholarship refunds) behave as they do in production.
//
// It is on only when all of these hold, and is otherwise never constructed:
//   - the key is a test-mode key (sk_test_ or rk_test_), so it can never touch a
//     live object;
//   - NEXT_PUBLIC_APP_ENV is not 'prod';
//   - the map is set and parses to at least one price_ → price_ pair.
// A map that is set but malformed throws, so a mistyped variable is seen at once
// rather than read as "no map".

export type PriceMap = ReadonlyMap<string, string>

const PRICE_ID = /^price_[A-Za-z0-9]+$/

/** The live → test map, or null when the swap must stay off. */
export function devPriceMap(env: NodeJS.ProcessEnv = process.env): PriceMap | null {
  const raw = env.STRIPE_DEV_PRICE_MAP?.trim()
  if (!raw) return null
  const key = env.STRIPE_SECRET_KEY ?? ''
  if (!/^(sk|rk)_test_/.test(key)) return null
  if (appEnv() === 'prod') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('STRIPE_DEV_PRICE_MAP is not valid JSON: expected {"price_live":"price_test", …}')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('STRIPE_DEV_PRICE_MAP must be a JSON object of live price id to test price id')
  }
  const map = new Map<string, string>()
  for (const [live, test] of Object.entries(parsed as Record<string, unknown>)) {
    if (!PRICE_ID.test(live) || typeof test !== 'string' || !PRICE_ID.test(test) || live === test) {
      throw new Error(`STRIPE_DEV_PRICE_MAP: ${live} must map to a different price_ id`)
    }
    map.set(live, test)
  }
  if (new Set(map.values()).size !== map.size) throw new Error('STRIPE_DEV_PRICE_MAP: two live prices map to the same test price')
  return map.size ? map : null
}

/** The same pairs the other way round. */
export function invert(map: PriceMap): PriceMap {
  return new Map([...map].map(([a, b]) => [b, a]))
}

/** Replaces each whole id in `text` (not one that is the start of a longer id). */
export function swapIds(text: string, map: PriceMap): string {
  if (!text || !map.size) return text
  return text.replace(/price_[A-Za-z0-9]+/g, (id) => map.get(id) ?? id)
}

/** A parsed JSON response with every string that is exactly a mapped id swapped. */
export function swapDeep(value: unknown, map: PriceMap): unknown {
  if (typeof value === 'string') return map.get(value) ?? value
  if (Array.isArray(value)) return value.map((v) => swapDeep(v, map))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = swapDeep(v, map)
    return out
  }
  return value
}

type HttpClient = NonNullable<Stripe.StripeConfig['httpClient']>

/** Wraps Stripe's HTTP client so live ids go out as test ids and come back as live ids. */
export function priceSwappingHttpClient(inner: HttpClient, toTest: PriceMap): HttpClient {
  const toLive = invert(toTest)
  return {
    getClientName: () => inner.getClientName(),
    async makeRequest(host, port, path, method, headers, requestData, protocol, timeout) {
      const res = await inner.makeRequest(host, port, swapIds(path, toTest), method, headers, swapIds(requestData, toTest), protocol, timeout)
      return {
        getStatusCode: () => res.getStatusCode(),
        getHeaders: () => res.getHeaders(),
        getRawResponse: () => res.getRawResponse(),
        toStream: (done: () => void) => res.toStream(done),
        toJSON: async () => swapDeep(await res.toJSON(), toLive),
      }
    },
  }
}
