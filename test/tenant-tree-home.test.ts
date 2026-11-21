// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The tenant tree's home page answers only for an active tenant other than the
// platform owner. Every page in the tree checks its own tenant, so this holds
// whichever way a request got here.

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

const CANARY = '11111111-1111-4111-8111-111111111111'
const ROWS = [
  { host: 'canary-academy.localhost', tenant_id: CANARY, tenant_slug: 'canary-academy' },
  { host: 'stellr.localhost', tenant_id: STELLR_TENANT_ID, tenant_slug: 'stellr' },
  // (a suspended tenant's host: tenant_host_map() returns active tenants only, so it is absent)
]

async function loadPage() {
  // The host map is cached per module instance.
  vi.resetModules()
  const mod = await import('@/app/%5Ft/[tenant]/page')
  return mod.default
}

beforeEach(() => {
  vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_TESTONLY')
  // B25: the host map is read with the publishable key (tenant_host_map()).
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_TESTONLY')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ROWS), { status: 200 })))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the tenant tree home page', () => {
  it('renders for an active tenant', async () => {
    const Page = await loadPage()
    await expect(Page({ params: Promise.resolve({ tenant: 'canary-academy' }) })).resolves.toBeTruthy()
  })

  it.each(['paused', 'nobody', 'stellr'])('answers 404 for %s', async (tenant) => {
    const Page = await loadPage()
    await expect(Page({ params: Promise.resolve({ tenant }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
