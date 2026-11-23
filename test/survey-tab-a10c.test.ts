// @vitest-environment node
//
// The event Survey tab and the 'surveys' area (S5 A10c): who reaches it, and what they get.
// A tenant's staff are refused unless the area is on the tenant path; then they get the
// narrowed view and the distribution's own settings, and every send stays refused. Stellr's
// staff call the area with Stellr's tenant. lib/survey/admin-data.test.ts drives the area's
// three paths; test/events-admin-paperwork-c17.test.ts holds the flag-off refusals.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TENANT = 'c0ffee00-0000-4000-8000-0000000000b2'
const STELLR = '00000000-0000-4000-8000-000000000001'
const D1 = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  tenantId: '',
  tenantPath: false,
  adminSurveyView: vi.fn(async (..._a: unknown[]) => ({ distribution: { id: '11111111-1111-4111-8111-111111111111' }, rows: [{}, {}] })),
  loadDistributionForEvent: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ id: '11111111-1111-4111-8111-111111111111', status: 'scheduled' })),
  logSurveyView: vi.fn(async (..._a: unknown[]) => {}),
  surveyAdminDb: vi.fn((..._a: unknown[]) => ({ store: true })),
  setDistributionGateCertificate: vi.fn(async (..._a: unknown[]) => {}),
  pauseDistribution: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  setEarlierGoLive: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  runOne: vi.fn(async (..._a: unknown[]) => ({})),
  resendInvitation: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
}))

vi.mock('@/lib/authz', async (importOriginal) => {
  const { tenantWideScope } = await import('@/lib/tenancy/scope-context')
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    requireEventRoute: async (slug: string) => ({
      ok: true,
      userId: 'user_x',
      isAdmin: false,
      tenantId: h.tenantId,
      eventSlug: slug,
      scope: tenantWideScope(h.tenantId, 'tenant_admin'),
      covers: (s: string) => s === slug,
    }),
    hasCapability: async () => true,
  }
})
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ service: true }) }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => null }))
vi.mock('@/lib/authz/principal', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadEventTenantId: async () => h.tenantId,
}))
vi.mock('@/lib/survey/admin', () => ({ adminSurveyView: h.adminSurveyView }))
vi.mock('@/lib/survey/admin-data', () => ({
  surveysOnTenantPath: () => h.tenantPath,
  loadDistributionForEvent: h.loadDistributionForEvent,
  logSurveyView: h.logSurveyView,
  surveyAdminDb: h.surveyAdminDb,
  setDistributionGateCertificate: h.setDistributionGateCertificate,
}))
vi.mock('@/lib/survey/distributions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pauseDistribution: h.pauseDistribution,
  setEarlierGoLive: h.setEarlierGoLive,
}))
vi.mock('@/lib/survey/audit', () => ({ writeAudit: async () => {}, logSurveyAccess: async () => {} }))
vi.mock('@/lib/survey/run', () => ({ runOne: h.runOne }))
vi.mock('@/lib/survey/send', () => ({ resendInvitation: h.resendInvitation }))

const ctx = { params: Promise.resolve({ slug: 'own' }) }
const post = (body: unknown) => new Request('https://app.test/api/admin/events/own/survey', { method: 'POST', body: JSON.stringify(body) })
const get = () => new Request('https://app.test/api/admin/events/own/survey')
const route = () => import('@/app/api/admin/events/[slug]/survey/route')

beforeEach(() => {
  vi.clearAllMocks()
  h.tenantPath = false
  h.tenantId = TENANT
})

describe("a tenant's staff", () => {
  it('are refused the tab and every action while the area is not on the tenant path', async () => {
    const { GET, POST } = await route()
    expect((await GET(get(), ctx)).status).toBe(503)
    expect((await POST(post({ action: 'pause' }), ctx)).status).toBe(503)
    expect(h.adminSurveyView).not.toHaveBeenCalled()
    expect(h.loadDistributionForEvent).not.toHaveBeenCalled()
    expect(h.pauseDistribution).not.toHaveBeenCalled()
  })

  it('on the tenant path get the narrowed view for their own tenant, and the view is logged for it', async () => {
    h.tenantPath = true
    const res = await (await route()).GET(get(), ctx)
    expect(res.status).toBe(200)
    expect(h.adminSurveyView.mock.calls[0][4]).toEqual({ tenantId: TENANT, stellr: false })
    expect(h.logSurveyView).toHaveBeenCalledWith({ service: true }, TENANT, { actor: 'user_x', eventSlug: 'own', distributionId: D1, rowCount: 2 })
  })

  it("on the tenant path change their distribution's settings through the area, with their own tenant", async () => {
    h.tenantPath = true
    const { POST } = await route()
    expect((await POST(post({ action: 'pause' }), ctx)).status).toBe(200)
    expect(h.loadDistributionForEvent).toHaveBeenCalledWith({ service: true }, TENANT, 'own')
    expect(h.surveyAdminDb).toHaveBeenCalledWith({ service: true }, TENANT)
    expect(h.pauseDistribution.mock.calls[0][0]).toEqual({ store: true })
    expect((await POST(post({ action: 'gate_certificate', on: true }), ctx)).status).toBe(200)
    expect(h.setDistributionGateCertificate.mock.calls[0].slice(1)).toEqual([TENANT, D1, true])
  })

  it.each([
    ['send_now', { action: 'send_now' }],
    ['resend', { action: 'resend', invitationId: D1 }],
    ['open_after_event', { action: 'open_after_event', acceptOlderMinorAgreements: false }],
    ['minor_agreement_override', { action: 'minor_agreement_override', on: true }],
  ])('on the tenant path are still refused %s, before anything is read or sent', async (_name, body) => {
    h.tenantPath = true
    const res = await (await route()).POST(post(body), ctx)
    expect(res.status).toBe(503)
    expect(h.loadDistributionForEvent).not.toHaveBeenCalled()
    expect(h.runOne).not.toHaveBeenCalled()
    expect(h.resendInvitation).not.toHaveBeenCalled()
  })
})

describe("Stellr's staff", () => {
  it.each([false, true])('get the full view with Stellr’s tenant (tenant path %s)', async (on) => {
    h.tenantId = STELLR
    h.tenantPath = on
    const res = await (await route()).GET(get(), ctx)
    expect(res.status).toBe(200)
    expect(h.adminSurveyView.mock.calls[0][4]).toEqual({ tenantId: STELLR, stellr: true })
  })

  it('still send now', async () => {
    h.tenantId = STELLR
    const res = await (await route()).POST(post({ action: 'send_now' }), ctx)
    expect(res.status).toBe(200)
    expect(h.loadDistributionForEvent).toHaveBeenCalledWith({ service: true }, STELLR, 'own')
    expect(h.setEarlierGoLive.mock.calls[0][0]).toEqual({ store: true })
    expect(h.runOne).toHaveBeenCalledWith({ service: true }, D1)
  })
})
