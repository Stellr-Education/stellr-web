// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// Marketing email (GATE-AUDIT remainder, critique item 2): every admin write, the test
// send and the audience preview record one platform audit event on Stellr's chain. The
// campaign or template is the target; field names, ids, counts and enums the metadata.
// Never a name, subject, body or address.

const TEMPLATE = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN = '22222222-2222-4222-8222-222222222222'
const TIER = '33333333-3333-4333-8333-333333333333'
const CALLER = 'user_adminplaceholder'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  sends: [] as Array<Record<string, unknown>>,
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
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true, isStellrAdmin: async () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'm-admin' }), tiptapToPlainText: () => '' }))
vi.mock('@/lib/email', () => ({
  MARKETING_FROM: 'from@example.test',
  sendEmail: async (m: Record<string, unknown>) => {
    h.sends.push(m)
  },
}))
vi.mock('@/lib/email-campaigns', () => ({
  appUrl: () => 'https://app.test',
  loadTemplate: async () => ({ id: TEMPLATE, subject: 'S', body_json: null }),
  resolveAudience: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
}))
vi.mock('@/lib/email-render', async (orig) => ({
  ...(await orig<typeof import('@/lib/email-render')>()),
  renderCampaignEmail: () => ({ subject: 'Placeholder subject', html: '<p>x</p>', text: 'x' }),
  tiptapToEmailHtml: () => '<p>x</p>',
}))

const { POST: preview } = await import('./audience/preview/route')
const { POST: createCampaign } = await import('./campaigns/route')
const campaign = await import('./campaigns/[id]/route')
const { POST: testSend } = await import('./campaigns/[id]/test/route')
const { POST: createTemplate } = await import('./templates/route')
const template = await import('./templates/[id]/route')

const send = (method: string, path: string, body?: unknown) =>
  new Request(`https://app.test/api/admin/email${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
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
  h.sends = []
  h.db = fakeSupabase({
    email_templates: [{ id: TEMPLATE, key: 'welcome', name: 'Welcome', subject: 'Hi', is_archived: false }],
    email_campaigns: [{ id: CAMPAIGN, template_id: TEMPLATE, status: 'draft', trigger_type: 'scheduled', scheduled_at: null }],
  })
})

describe('email: audience preview', () => {
  it('records the count and how many tiers it filtered on, never who', async () => {
    const res = await preview(send('POST', '/audience/preview', { activeOnly: true, tierIds: [TIER] }))
    expect(await res.json()).toEqual({ count: 3 })
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'email.audience.preview', target: { table: 'members', id: null }, metadata: { recipients: 3, tier_ids: 1, status: 200 } },
    ])
  })
})

describe('email: campaigns', () => {
  it('create, edit with activate, and archive each name the campaign', async () => {
    const created = await createCampaign(
      send('POST', '/campaigns', { name: 'Placeholder Campaign', templateId: TEMPLATE, triggerType: 'scheduled', scheduledAt: '2031-01-01T00:00:00Z' }),
    )
    expect(created.status).toBe(200)
    const { id } = await created.json()
    expect((await campaign.PATCH(send('PATCH', `/campaigns/${CAMPAIGN}`, { name: 'Renamed Placeholder', scheduledAt: '2031-02-01T00:00:00Z', action: 'activate' }), ctx(CAMPAIGN))).status).toBe(200)
    expect((await campaign.DELETE(send('DELETE', `/campaigns/${CAMPAIGN}`), ctx(CAMPAIGN))).status).toBe(200)
    await flush()
    const target = { table: 'email_campaigns', id: CAMPAIGN }
    expect(recorded()).toEqual([
      { ...stellr, action: 'email.campaign.create', target: { table: 'email_campaigns', id }, metadata: { template_id: TEMPLATE, trigger_type: 'scheduled', status: 200 } },
      { ...stellr, action: 'email.campaign.update', target, metadata: { fields: ['name', 'scheduled_at'], campaign_action: 'activate', campaign_status: 'scheduled', status: 200 } },
      { ...stellr, action: 'email.campaign.archive', target, metadata: { status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Placeholder|2031/)
  })

  it('an edit the status forbids is a 409 and records nothing', async () => {
    h.db.table('email_campaigns')[0].status = 'sent'
    expect((await campaign.PATCH(send('PATCH', `/campaigns/${CAMPAIGN}`, { name: 'x' }), ctx(CAMPAIGN))).status).toBe(409)
    await flush()
    expect(h.audits).toEqual([])
  })

  it('a test send names the campaign and its template; the address is never stored', async () => {
    expect((await testSend(send('POST', `/campaigns/${CAMPAIGN}/test`, { email: 'tester@example.test' }), ctx(CAMPAIGN))).status).toBe(200)
    await flush()
    expect(h.sends).toHaveLength(1)
    expect(recorded()).toEqual([
      { ...stellr, action: 'email.campaign.test_send', target: { table: 'email_campaigns', id: CAMPAIGN }, metadata: { template_id: TEMPLATE, status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('example.test')
  })
})

describe('email: templates', () => {
  it('create, edit and archive name the template; never its name, subject or body', async () => {
    const created = await createTemplate(send('POST', '/templates', { name: 'Spring Placeholder', subject: 'Hello there', bodyJson: { type: 'doc' } }))
    expect(created.status).toBe(200)
    const { id } = await created.json()
    expect((await template.PATCH(send('PATCH', `/templates/${TEMPLATE}`, { subject: 'New subject here' }), ctx(TEMPLATE))).status).toBe(200)
    // Still used by a draft campaign: refused, nothing recorded.
    expect((await template.DELETE(send('DELETE', `/templates/${TEMPLATE}`), ctx(TEMPLATE))).status).toBe(409)
    h.db.table('email_campaigns')[0].status = 'archived'
    expect((await template.DELETE(send('DELETE', `/templates/${TEMPLATE}`), ctx(TEMPLATE))).status).toBe(200)
    await flush()
    const target = { table: 'email_templates', id: TEMPLATE }
    expect(recorded()).toEqual([
      { ...stellr, action: 'email.template.create', target: { table: 'email_templates', id }, metadata: { template_key: 'spring-placeholder', status: 200 } },
      { ...stellr, action: 'email.template.update', target, metadata: { fields: ['subject'], status: 200 } },
      { ...stellr, action: 'email.template.archive', target, metadata: { status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Hello there|New subject/)
  })

  it('a failed write is a 500 and is recorded with its status', async () => {
    h.db = fakeSupabase({ email_templates: [] }, { failOn: (t, a) => (t === 'email_templates' && a === 'update' ? 'boom' : null) })
    expect((await template.PATCH(send('PATCH', `/templates/${TEMPLATE}`, { name: 'x' }), ctx(TEMPLATE))).status).toBe(500)
    await flush()
    expect(recorded()).toEqual([
      { ...stellr, action: 'email.template.update', target: { table: 'email_templates', id: TEMPLATE }, metadata: { fields: ['name'], status: 500 } },
    ])
  })
})
