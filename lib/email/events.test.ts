// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import {
  EMAIL_EVENT_TYPES, RESEND_EVENT_TYPE, hashRecipient, linkForStorage, mapResendEvent,
  emailEventsCutoff, pruneEmailEvents, readTags, recordEmailEvent, type ResendWebhookEvent,
} from './events'

const AT = '2026-11-23T20:00:00.000Z'
const TENANT = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'

const ev = (type: string, data: ResendWebhookEvent['data'] = {}, at: string | null = AT): ResendWebhookEvent => ({
  type,
  ...(at ? { created_at: at } : {}),
  data: { email_id: 're_1', created_at: '2026-11-23T19:59:00.000Z', to: ['Parent@Example.test'], ...data },
})

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe('mapResendEvent: every type', () => {
  it('maps each of the nine Resend email events to its stored type', () => {
    expect(Object.values(RESEND_EVENT_TYPE).sort()).toEqual([...EMAIL_EVENT_TYPES].sort())
    for (const [resendType, stored] of Object.entries(RESEND_EVENT_TYPE)) {
      const m = mapResendEvent(ev(resendType))
      expect(m, resendType).toMatchObject({ provider: 'resend', providerEmailId: 're_1', type: stored, recipient: 'parent@example.test', occurredAt: AT })
    }
  })

  it('ignores events it does not store, and events with no message id or recipient', () => {
    expect(mapResendEvent(ev('email.scheduled'))).toBeNull()
    expect(mapResendEvent(ev('email.received'))).toBeNull()
    expect(mapResendEvent(ev('contact.created'))).toBeNull()
    expect(mapResendEvent(ev('email.delivered', { email_id: undefined }))).toBeNull()
    expect(mapResendEvent(ev('email.delivered', { to: [] }))).toBeNull()
    expect(mapResendEvent({ type: 'email.delivered' })).toBeNull()
  })

  it('keys on the event time, falling back to the click time then the message time', () => {
    expect(mapResendEvent(ev('email.clicked', { click: { link: 'https://x.test/a', timestamp: '2026-11-23T20:05:00Z' } }, null))?.occurredAt)
      .toBe('2026-11-23T20:05:00.000Z')
    expect(mapResendEvent(ev('email.opened', {}, null))?.occurredAt).toBe('2026-11-23T19:59:00.000Z')
  })

  it('keeps bounce detail, the failure reason and the suppression type, and nothing else', () => {
    const b = mapResendEvent(ev('email.bounced', { bounce: { type: 'Permanent', subType: 'General', message: 'No such user' }, subject: 'Hi Lily' } as never))
    expect(b?.payloadMin).toEqual({ bounce: { type: 'Permanent', sub_type: 'General', message: 'No such user' } })
    expect(mapResendEvent(ev('email.failed', { failed: { reason: 'invalid from' } }))?.payloadMin).toEqual({ reason: 'invalid from' })
    expect(mapResendEvent(ev('email.suppressed', { suppressed: { type: 'OnAccountSuppressionList' } }))?.payloadMin)
      .toEqual({ suppressed: { type: 'OnAccountSuppressionList' } })
    expect(mapResendEvent(ev('email.opened'))?.payloadMin).toEqual({})
  })

  it('stores a click as origin and path only, and no link for other types', () => {
    const c = mapResendEvent(ev('email.clicked', { click: { link: 'https://stellreducation.org/events/x?token=secret#y' } }))
    expect(c?.linkUrl).toBe('https://stellreducation.org/events/x')
    expect(linkForStorage('javascript:alert(1)')).toBeNull()
    expect(linkForStorage('not a url')).toBeNull()
    expect(mapResendEvent(ev('email.delivered'))?.linkUrl).toBeNull()
  })

  it('reads tags as an object or as name/value pairs, dropping malformed ids', () => {
    expect(readTags({ stream: 'community', n: 3 })).toEqual({ stream: 'community' })
    expect(readTags([{ name: 'feature', value: 'campaign' }, { name: 1, value: 'x' }])).toEqual({ feature: 'campaign' })
    const m = mapResendEvent(ev('email.delivered', { tags: { tenant: 'not-a-uuid', stream: 'marketing', member_id: MEMBER } }))
    expect(m?.tags).toEqual({ tenantId: null, stream: 'marketing', feature: null, ref: null, memberId: MEMBER })
  })

  it('counts extra recipients on a multi-recipient message', () => {
    expect(mapResendEvent(ev('email.delivered', { to: ['a@x.test', 'b@x.test'] }))?.payloadMin).toEqual({ to_count: 2 })
  })
})

describe('recordEmailEvent', () => {
  it('writes one row per event and nothing on a redelivery', async () => {
    const fake = fakeSupabase({ email_events: [] })
    expect(await recordEmailEvent(fake.client, ev('email.delivered'))).toEqual({ recorded: true, type: 'delivered' })
    expect(await recordEmailEvent(fake.client, ev('email.delivered'))).toEqual({ recorded: false, type: 'delivered' })
    // A second open later is its own row; the same open again is not.
    await recordEmailEvent(fake.client, ev('email.opened'))
    await recordEmailEvent(fake.client, ev('email.opened', {}, '2026-11-24T08:00:00.000Z'))
    await recordEmailEvent(fake.client, ev('email.opened'))
    expect(fake.table('email_events').map((r) => r.type)).toEqual(['delivered', 'opened', 'opened'])
    expect(fake.table('email_events')[0]).toMatchObject({
      provider: 'resend', tenant_id: STELLR_TENANT_ID, recipient: 'parent@example.test',
      recipient_hash: hashRecipient(' PARENT@example.test '), member_id: null,
    })
  })

  it('records nothing for an event type it does not store', async () => {
    const fake = fakeSupabase({ email_events: [] })
    expect(await recordEmailEvent(fake.client, ev('email.scheduled'))).toEqual({ recorded: false, type: null })
    expect(fake.table('email_events')).toHaveLength(0)
  })

  it('takes tenant, stream, feature, ref and member from the tags first', async () => {
    const fake = fakeSupabase({
      email_events: [],
      email_outbox: [{ provider_id: 're_1', tenant_id: null, kind: 'transactional' }],
    })
    // PR A's keys: `tenant`, `stream` (transactional | marketing), `feature`, `ref`.
    await recordEmailEvent(fake.client, ev('email.delivered', { tags: { tenant: TENANT, stream: 'marketing', feature: 'campaign', ref: 'c-9', member_id: MEMBER } }))
    expect(fake.table('email_events')[0]).toMatchObject({ tenant_id: TENANT, stream: 'marketing', feature: 'campaign', ref: 'c-9', member_id: MEMBER })
    // tenant_id is read as well.
    await recordEmailEvent(fake.client, ev('email.opened', { tags: { tenant_id: TENANT } }))
    expect(fake.table('email_events')[1]).toMatchObject({ tenant_id: TENANT })
  })

  it('falls back to the outbox row by Resend id', async () => {
    const fake = fakeSupabase({ email_events: [], email_outbox: [{ provider_id: 're_1', tenant_id: TENANT, kind: 'marketing' }] })
    await recordEmailEvent(fake.client, ev('email.delivered'))
    expect(fake.table('email_events')[0]).toMatchObject({ tenant_id: TENANT, stream: 'marketing' })
  })

  it('falls back to the event-email run that recorded the Resend id', async () => {
    const fake = fakeSupabase({
      email_events: [],
      event_email_sends: [{
        id: 's1', tenant_id: TENANT, event_slug: 'cosdc-2027',
        recipients: [{ email: 'other@x.test', resendId: 're_0' }, { email: 'parent@example.test', resendId: 're_1', memberId: MEMBER }],
      }],
    })
    await recordEmailEvent(fake.client, ev('email.bounced', { bounce: { type: 'Permanent' } }))
    expect(fake.table('email_events')[0]).toMatchObject({
      tenant_id: TENANT, stream: 'transactional', feature: 'event_email', ref: 'cosdc-2027', member_id: MEMBER, type: 'bounced',
    })
  })

  it('falls back to the signing invitation, then finds the member by address', async () => {
    const fake = fakeSupabase({
      email_events: [],
      agreement_recipients: [{ id: 'r1', invite_email_id: 're_1', tenant_id: TENANT }],
      members: [{ id: MEMBER, email: 'Parent@Example.test' }],
    })
    await recordEmailEvent(fake.client, ev('email.delivered'))
    expect(fake.table('email_events')[0]).toMatchObject({ tenant_id: TENANT, feature: 'esign', stream: 'transactional', member_id: MEMBER })
  })

  it('still records the event when a lookup fails', async () => {
    const fake = fakeSupabase({ email_events: [] }, { failOn: (t) => (t === 'email_outbox' || t === 'members' ? 'boom' : null) })
    expect((await recordEmailEvent(fake.client, ev('email.delivered'))).recorded).toBe(true)
    expect(fake.table('email_events')[0]).toMatchObject({ tenant_id: STELLR_TENANT_ID, member_id: null })
  })

  it('throws when the write fails, so the webhook asks for a retry', async () => {
    const fake = fakeSupabase({ email_events: [] }, { failOn: (t, a) => (t === 'email_events' && a === 'upsert' ? 'down' : null) })
    await expect(recordEmailEvent(fake.client, ev('email.delivered'))).rejects.toThrow(/down/)
  })

  it('stores under Stellr, marked unresolved, when a tagged tenant no longer exists', async () => {
    let calls = 0
    const upsert = vi.fn((row: Record<string, unknown>) => ({
      select: async () => {
        calls++
        return calls === 1
          ? { data: null, error: { message: 'violates foreign key constraint', code: '23503' } }
          : { data: [{ id: 'e1', ...row }], error: null }
      },
    }))
    const maybe = { data: null, error: null }
    const chain: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'contains', 'limit', 'ilike']) chain[k] = () => chain
    chain.maybeSingle = async () => maybe
    chain.then = (r: (v: unknown) => unknown) => r({ data: [], error: null })
    const db = { from: (t: string) => (t === 'email_events' ? { upsert } : chain) }
    const out = await recordEmailEvent(db as never, ev('email.delivered', { tags: { tenant_id: TENANT, member_id: MEMBER } }))
    expect(out.recorded).toBe(true)
    expect(upsert.mock.calls[1][0]).toMatchObject({ tenant_id: STELLR_TENANT_ID, member_id: null, payload_min: { unresolved: true } })
  })
})

describe('pruneEmailEvents', () => {
  it('deletes rows older than 13 months and reports the count', async () => {
    const lt = vi.fn(async () => ({ error: null, count: 4 }))
    const del = vi.fn(() => ({ lt }))
    const db = { from: vi.fn(() => ({ delete: del })) }
    const out = await pruneEmailEvents(db as never, new Date('2026-11-23T04:30:00Z'))
    expect(out).toEqual({ cutoff: '2025-10-23T04:30:00.000Z', deleted: 4 })
    expect(db.from).toHaveBeenCalledWith('email_events')
    expect(del).toHaveBeenCalledWith({ count: 'exact' })
    expect(lt).toHaveBeenCalledWith('occurred_at', '2025-10-23T04:30:00.000Z')
    expect(emailEventsCutoff(new Date('2027-01-31T00:00:00Z'))).toBe('2025-12-31T00:00:00.000Z')
  })

  it('throws on a failed delete', async () => {
    const db = { from: () => ({ delete: () => ({ lt: async () => ({ error: { message: 'nope' }, count: null }) }) }) }
    await expect(pruneEmailEvents(db as never, new Date())).rejects.toThrow(/nope/)
  })
})
