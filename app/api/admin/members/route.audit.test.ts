// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The admin member routes a Stellr Staff member can write (Staff role P3/P4, GATE-AUDIT):
// each records one platform audit event on Stellr's chain, naming the signed-in caller,
// with the member (or the row it made) as the target and only ids, counts and enums in
// the metadata. Down to the audit() call, with PLATFORM_AUDIT_ENABLED on; off, nothing.

const MEMBER = '33333333-3333-4333-8333-333333333333'
const MEMBERSHIP = '44444444-4444-4444-8444-444444444444'
const TIER = '55555555-5555-4555-8555-555555555555'
const CALLER = 'user_staffplaceholder'

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  afters: [] as Array<() => Promise<unknown>>,
  audits: [] as Array<Record<string, unknown>>,
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
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/activity-log', () => ({
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin', actorLabel: 'Admin' }),
  crewActorType: async () => 'admin',
  logActivity: async () => {},
}))
vi.mock('@/lib/entitlements', () => ({ grantTierAllocations: async () => {} }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'm-admin' }) }))
vi.mock('@/lib/member-invite', () => ({ sendAccountInvite: async () => ({ sent: true }) }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/background-provider', () => ({
  getBackgroundProvider: () => ({
    name: 'checkr',
    configured: () => true,
    order: async () => ({ candidateRef: 'cand_placeholder', invitationRef: 'inv_placeholder', reportRef: null, invitationUrl: 'https://invite.test/x' }),
  }),
}))
vi.mock('@/lib/compliance', () => ({ requiresBackgroundCheck: () => true }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {}, SandboxCredentialsError: class extends Error {} }))
vi.mock('@/lib/membership-grants', () => ({
  applyGrantTrigger: async () => ({ rule: null, granted: false }),
  grantTier: async () => ({ granted: true, membershipId: MEMBERSHIP }),
  fireTierPurchased: async () => {},
}))
vi.mock('@/lib/tiers-server', () => ({ checkTierAllowedForMember: async () => ({ ok: true }) }))
vi.mock('@/lib/license-review', () => ({ notifyLicenseVerified: async () => {} }))
vi.mock('@/lib/event-manager', () => ({ recheckEventManagerClearance: async () => {} }))
vi.mock('@/lib/uploads', () => ({ claimUpload: async () => ({ bytes: new Uint8Array(), format: 'png' }) }))
vi.mock('@/lib/volunteer', () => ({
  VOLUNTEER_PROGRAM_TITLE: 'Stellr Volunteer Program',
  VOLUNTEER_MEMBER_COLUMNS: 'id, email',
  dispatchVolunteerAgreement: async () => 'issued',
  grantVolunteerRole: async () => {},
  revokeVolunteerRole: async () => {},
}))

const { POST: createMember } = await import('./route')
const { POST: orderCheck } = await import('./[id]/background-check/route')
const { POST: addParticipation } = await import('./[id]/event-participations/route')
const { POST: sendInvite } = await import('./[id]/invite/route')
const { POST: updateLicense } = await import('./[id]/license/route')
const { POST: attachDocument } = await import('./[id]/license/document/route')
const { POST: assignTier } = await import('./[id]/memberships/route')
const { PATCH: updateMembership, DELETE: revokeMembership } = await import('./[id]/memberships/[membershipId]/route')
const { POST: issueAgreement } = await import('./[id]/volunteer-agreement/route')
const { POST: grantVolunteer, DELETE: revokeVolunteer } = await import('./[id]/volunteer/route')

const send = (method: string, path: string, body?: unknown) =>
  new Request(`https://app.test/api/admin/members${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const id = { params: Promise.resolve({ id: MEMBER }) }
const flush = async () => {
  for (const task of h.afters.splice(0)) await task()
}
const recorded = () => h.audits.map((a) => ({ action: a.action, tenantId: a.tenantId, actor: a.actor, target: a.target, metadata: a.metadata }))

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  h.afters = []
  h.audits = []
  h.db = fakeSupabase({
    members: [{ id: MEMBER, first_name: 'Pat', last_name: 'Doe', email: 'pat@example.test', event_role: 'mentor', date_of_birth: '1990-01-01' }],
    member_teacher_licenses: [{ id: 'lic-1', member_id: MEMBER, expiry_date: '2030-01-01', document_path: null, updated_at: 'v1' }],
    member_memberships: [{ id: MEMBERSHIP, member_id: MEMBER, renewal_status: 'active', is_complimentary: true, expires_at: null }],
    member_background_checks: [],
  })
})

const common = { tenantId: STELLR_TENANT_ID, actor: CALLER }

describe('members: create', () => {
  it('records the new member as the target, and nothing typed into the form', async () => {
    const res = await createMember(send('POST', '', { first_name: 'New', last_name: 'Person', email: 'new@example.test', date_of_birth: '1990-02-03', gender: 'female' }))
    expect(res.status).toBe(201)
    const { member } = await res.json()
    await flush()
    expect(recorded()).toEqual([
      { ...common, action: 'member.record.create', target: { table: 'members', id: member.id }, metadata: { school_linked: false, tier_assigned: false, status: 201 } },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/New|Person|example\.test|1990/)
  })

  it('a refusal (409 for a duplicate email) records nothing', async () => {
    expect((await createMember(send('POST', '', { first_name: 'Pat', last_name: 'Doe', email: 'pat@example.test' }))).status).toBe(409)
    await flush()
    expect(h.audits).toEqual([])
  })

  it('with the flag off, nothing is scheduled or written', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    expect((await createMember(send('POST', '', { first_name: 'New', last_name: 'Person', email: 'new@example.test', date_of_birth: '1990-02-03', gender: 'female' }))).status).toBe(201)
    await flush()
    expect(h.afters).toEqual([])
    expect(h.audits).toEqual([])
  })
})

describe('members/[id]: each Staff-writable write records one event on the member', () => {
  it('background check, invite, licence, document, volunteer agreement and role', async () => {
    expect((await orderCheck(send('POST', `/${MEMBER}/background-check`), id)).status).toBe(200)
    expect((await sendInvite(send('POST', `/${MEMBER}/invite`), id)).status).toBe(200)
    expect((await updateLicense(send('POST', `/${MEMBER}/license`, { action: 'unverify' }), id)).status).toBe(200)
    expect((await attachDocument(send('POST', `/${MEMBER}/license/document`, { storagePath: `${MEMBER}/doc.png`, fileType: 'image/png' }), id)).status).toBe(200)
    expect((await issueAgreement(send('POST', `/${MEMBER}/volunteer-agreement`), id)).status).toBe(200)
    expect((await grantVolunteer(send('POST', `/${MEMBER}/volunteer`), id)).status).toBe(200)
    expect((await revokeVolunteer(send('DELETE', `/${MEMBER}/volunteer`), id)).status).toBe(200)
    await flush()
    const target = { table: 'members', id: MEMBER }
    const checkId = h.db.table('member_background_checks')[0].id
    expect(recorded()).toEqual([
      { ...common, action: 'compliance.background_check.order', target, metadata: { check_id: checkId, status: 200 } },
      { ...common, action: 'member.invite.send', target, metadata: { status: 200 } },
      { ...common, action: 'compliance.license.update', target, metadata: { license_action: 'unverify', status: 200 } },
      { ...common, action: 'compliance.license_document.attach', target, metadata: { status: 200 } },
      { ...common, action: 'agreement.volunteer.issue', target, metadata: { agreement: 'issued', status: 200 } },
      { ...common, action: 'role.volunteer.grant', target, metadata: { status: 200 } },
      { ...common, action: 'role.volunteer.revoke', target, metadata: { status: 200 } },
    ])
  })

  it('event participations: the new record is the target, the member and counts the metadata', async () => {
    const res = await addParticipation(send('POST', `/${MEMBER}/event-participations`, { event_year: 2026, team_name: 'Team Free Text', award: 'Best in show' }), id)
    expect(res.status).toBe(200)
    const { participation } = await res.json()
    await flush()
    expect(recorded()).toEqual([
      {
        ...common,
        action: 'event_participation.record.create',
        target: { table: 'event_participations', id: participation.id },
        metadata: { member_id: MEMBER, has_award: true, grants: 0, status: 200 },
      },
    ])
    expect(JSON.stringify(h.audits)).not.toMatch(/Free Text|Best in show/)
  })

  it('memberships: grant, update (field names, never values) and revoke', async () => {
    const one = { params: Promise.resolve({ id: MEMBER, membershipId: MEMBERSHIP }) }
    expect((await assignTier(send('POST', `/${MEMBER}/memberships`, { tierId: TIER }), id)).status).toBe(200)
    expect((await updateMembership(send('PATCH', `/${MEMBER}/memberships/${MEMBERSHIP}`, { expires_at: '2031-01-01' }), one)).status).toBe(200)
    expect((await revokeMembership(send('DELETE', `/${MEMBER}/memberships/${MEMBERSHIP}`), one)).status).toBe(200)
    await flush()
    expect(recorded()).toEqual([
      { ...common, action: 'membership.tier.grant', target: { table: 'members', id: MEMBER }, metadata: { tier_id: TIER, status: 200 } },
      { ...common, action: 'membership.record.update', target: { table: 'member_memberships', id: MEMBERSHIP }, metadata: { member_id: MEMBER, fields: ['expires_at'], status: 200 } },
      { ...common, action: 'membership.record.revoke', target: { table: 'member_memberships', id: MEMBERSHIP }, metadata: { member_id: MEMBER, status: 200 } },
    ])
    expect(JSON.stringify(h.audits)).not.toContain('2031')
  })

  it('a tier name that is not an id never reaches the metadata', async () => {
    expect((await assignTier(send('POST', `/${MEMBER}/memberships`, { tierId: 'Pathfinder' }), id)).status).toBe(200)
    await flush()
    expect(h.audits[0].metadata).toEqual({ tier_id: null, status: 200 })
  })

  it('a licence save records the action, never the number, state or expiry', async () => {
    const res = await updateLicense(
      send('POST', `/${MEMBER}/license`, { action: 'save', license_number: 'LN-998877', licensing_state: 'NV', expiry_date: '2031-06-30' }),
      id,
    )
    expect(res.status).toBe(200)
    await flush()
    expect(recorded()).toEqual([{ ...common, action: 'compliance.license.update', target: { table: 'members', id: MEMBER }, metadata: { license_action: 'save', status: 200 } }])
    expect(JSON.stringify(h.audits)).not.toMatch(/998877|2031/)
  })
})
