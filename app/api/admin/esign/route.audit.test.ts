// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// Signing admin (GATE-AUDIT remainder, critique item 2): maintenance, the membership
// backfill, the engine settings and the agreement-document editor each record one
// platform audit event on Stellr's chain. Ids, counts and enums only: never an
// allowlisted address, a title or a storage path.

const VERSION = '11111111-1111-4111-8111-111111111111'
const CALLER = 'user_adminplaceholder'

const h = vi.hoisted(() => ({
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  approveFails: false,
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
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: CALLER, sessionClaims: {} }),
  currentUser: async () => ({ firstName: 'Placeholder', lastName: 'Admin' }),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/cron-runs', () => ({ startCronRun: async () => ({ fail: () => {}, finish: async () => {} }) }))
vi.mock('@/lib/esign/maintenance', () => ({
  ALL_STEPS: ['usage', 'archive', 'retention'],
  runEsignMaintenance: async (_db: unknown, opts: { dryRun?: boolean }) => ({ dryRun: Boolean(opts.dryRun) }),
}))
vi.mock('@/lib/membership-backfill', () => ({
  backfillMembershipAgreements: async (_db: unknown, o: { dryRun: boolean }) => ({ dryRun: o.dryRun, candidates: 7, outstanding: 7, issued: o.dryRun ? 0 : 5, outcomes: {} }),
}))
vi.mock('@/lib/esign/state', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/state')>()),
  applyStateUpdate: async () => {},
  loadEngineSummary: async () => ({ ok: true }),
}))
vi.mock('@/lib/esign/native/template-admin', async (orig) => {
  const real = await orig<typeof import('@/lib/esign/native/template-admin')>()
  return {
    ...real,
    createVersion: async () => ({ id: VERSION, version: 3 }),
    approveVersion: async () => {
      if (h.approveFails) throw new real.TemplateAdminError('The checks failed.', ['x'])
      return { key: 'membership-agreement', version: 3 }
    },
    acceptUpload: async () => ({ pdfPath: 'drafts/private-path.pdf', sha256: 'a'.repeat(64), pageCount: 4 }),
    loadTemplateFile: async () => new Uint8Array([1]),
  }
})
vi.mock('@/lib/esign/native/template', () => ({ parseFieldMap: () => ({ fields: [] }) }))
vi.mock('@/lib/esign/native/template-sample', () => ({ labelSample: {}, renderSample: async () => new Uint8Array([37, 80, 68, 70]) }))

const { POST: maintenance } = await import('./maintenance/route')
const { POST: backfill } = await import('./membership-backfill/route')
const { PATCH: updateState } = await import('./state/route')
const { POST: approve } = await import('./templates/[id]/approve/route')
const { POST: preview } = await import('./templates/preview/route')
const { POST: saveVersion } = await import('./templates/route')
const { POST: upload } = await import('./templates/upload/route')

const json = (path: string, body: unknown, method = 'POST') =>
  new Request(`https://app.test/api/admin/esign${path}`, { method, body: JSON.stringify(body) })
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
  h.approveFails = false
})

describe('esign: runs and settings', () => {
  it('maintenance, the backfill and a settings change record what was asked, in counts and codes', async () => {
    expect((await maintenance(new NextRequest(json('/maintenance', { dryRun: true, steps: ['usage'] })))).status).toBe(200)
    expect((await backfill(json('/membership-backfill', { dryRun: false, limit: 10 }))).status).toBe(200)
    expect((await updateState(new NextRequest(json('/state', { mode: 'auto', reserve: 5, overflowAllowlist: ['someone@example.test'] }, 'PATCH')))).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'esign.maintenance.run', target: { table: 'cron_runs', id: null }, metadata: { dry_run: true, steps: ['usage'], status: 200 } },
      { ...stellr, action: 'esign.membership_backfill.run', target: { table: 'agreements', id: null }, metadata: { dry_run: false, limit: 10, candidates: 7, issued: 5, status: 200 } },
      {
        ...stellr,
        action: 'esign.state.update',
        target: { table: 'esign_provider_state', id: null },
        metadata: { fields: ['mode', 'reserve', 'overflowAllowlist'], mode: 'auto', reserve: 5, allowlist_size: 1, status: 200 },
      },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('example.test')
  })

  it('an invalid settings body is a 400 and records nothing', async () => {
    expect((await updateState(new NextRequest(json('/state', { mode: 'sideways' }, 'PATCH')))).status).toBe(400)
    await flush()
    expect(h.audits).toEqual([])
  })
})

describe('esign: the agreement-document editor', () => {
  it('upload, preview, save and approve name the version, never the title, path or approver name', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'doc.pdf', { type: 'application/pdf' }))
    expect((await upload(new Request('https://app.test/api/admin/esign/templates/upload', { method: 'POST', body: form }))).status).toBe(200)
    expect((await preview(json('/templates/preview', { pdfPath: 'drafts/private-path.pdf', fieldMap: {} }))).status).toBe(200)
    expect((await saveVersion(json('/templates', { key: 'membership-agreement', title: 'Placeholder Title', pdfPath: 'drafts/private-path.pdf', fieldMap: {} }))).status).toBe(200)
    expect((await approve(json(`/templates/${VERSION}/approve`, { confirm: 'membership-agreement v3' }), { params: Promise.resolve({ id: VERSION }) })).status).toBe(200)
    await flush()
    const version = { table: 'esign_templates', id: VERSION }
    expect(recorded()).toEqual([
      { ...stellr, action: 'esign.template.upload', target: { table: 'esign_templates', id: null }, metadata: { sha256: 'a'.repeat(64), page_count: 4, status: 200 } },
      { ...stellr, action: 'esign.template.preview', target: { table: 'esign_templates', id: null }, metadata: { status: 200 } },
      { ...stellr, action: 'esign.template.create', target: version, metadata: { template_key: 'membership-agreement', version: 3, status: 200 } },
      { ...stellr, action: 'esign.template.approve', target: version, metadata: { template_key: 'membership-agreement', version: 3, status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Placeholder|private-path/)
  })

  it('an approval whose checks fail is a 422 and records nothing', async () => {
    h.approveFails = true
    expect((await approve(json(`/templates/${VERSION}/approve`, { confirm: 'x' }), { params: Promise.resolve({ id: VERSION }) })).status).toBe(422)
    await flush()
    expect(h.audits).toEqual([])
  })
})
