// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const { capture } = vi.hoisted(() => ({ capture: vi.fn(async () => {}) }))
vi.mock('./lib/app-errors', async () => ({
  captureRequestError: capture,
  cleanTenantId: (await vi.importActual<typeof import('./lib/app-errors')>('./lib/app-errors')).cleanTenantId,
}))

import { onRequestError } from './instrumentation'

const request = { path: '/api/x', method: 'GET', headers: {} }
const context = { routerKind: 'App Router', routePath: '/api/x', routeType: 'route', revalidateReason: undefined } as const

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('instrumentation onRequestError', () => {
  it('hands Node-runtime errors to the recorder', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    const err = new Error('boom')
    await onRequestError(err, request, context)
    expect(capture).toHaveBeenCalledWith(err, request, context, { tenantId: null })
  })

  it('passes the tenant a tenant host served (S6-CON-b)', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    const tenantRequest = { ...request, headers: { 'x-stellr-tenant-id': '5e550000-0000-4000-8000-0000000000b2' } }
    await onRequestError(new Error('boom'), tenantRequest, context)
    expect(capture).toHaveBeenCalledWith(expect.anything(), tenantRequest, context, { tenantId: '5e550000-0000-4000-8000-0000000000b2' })
  })

  it('does nothing on the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    await onRequestError(new Error('boom'), request, context)
    expect(capture).not.toHaveBeenCalled()
  })

  it('never throws, even if the recorder does', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    capture.mockRejectedValueOnce(new Error('recorder broke'))
    await expect(onRequestError(new Error('boom'), request, context)).resolves.toBeUndefined()
  })
})
