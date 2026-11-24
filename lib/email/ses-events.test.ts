import { describe, expect, it } from 'vitest'
import { isPermanentBounce, mapSesEvent } from './ses-events'

const mail = { messageId: 'ses-1', timestamp: '2026-11-24T01:00:00Z', destination: ['a@example.org'], tags: { stream: ['transactional'], tenant: ['5e550000-0000-4000-8000-0000000000b2'], feature: ['event_email'] } }

describe('mapSesEvent', () => {
  it('maps a delivery with its tags', () => {
    const [m] = mapSesEvent({ eventType: 'Delivery', mail, delivery: { recipients: ['a@example.org'], timestamp: '2026-11-24T01:00:05Z' } })
    expect(m).toMatchObject({ provider: 'ses', providerEmailId: 'ses-1', type: 'delivered', recipient: 'a@example.org', occurredAt: '2026-11-24T01:00:05.000Z' })
    expect(m.tags).toMatchObject({ tenantId: '5e550000-0000-4000-8000-0000000000b2', stream: 'transactional', feature: 'event_email' })
  })
  it('maps one row per bounced recipient, keeping the bounce type', () => {
    const ev = { eventType: 'Bounce', mail, bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'a@example.org', diagnosticCode: '550 no such user' }, { emailAddress: 'b@example.org' }] } }
    const rows = mapSesEvent(ev)
    expect(rows.map((r) => r.recipient)).toEqual(['a@example.org', 'b@example.org'])
    expect(rows[0].payloadMin).toEqual({ bounce: { type: 'Permanent', sub_type: 'General', message: '550 no such user' } })
    expect(isPermanentBounce(ev)).toBe(true)
  })
  it('maps complaints, sends, rejects and delays', () => {
    expect(mapSesEvent({ eventType: 'Complaint', mail, complaint: { complainedRecipients: [{ emailAddress: 'a@example.org' }] } })[0].type).toBe('complained')
    expect(mapSesEvent({ eventType: 'Send', mail })[0].type).toBe('sent')
    expect(mapSesEvent({ eventType: 'Reject', mail, reject: { reason: 'Bad content' } })[0]).toMatchObject({ type: 'failed', payloadMin: { reason: 'Bad content' } })
    expect(mapSesEvent({ eventType: 'DeliveryDelay', mail, deliveryDelay: { delayedRecipients: [{ emailAddress: 'a@example.org' }] } })[0].type).toBe('delivery_delayed')
  })
  it('ignores unknown types and events without a message id', () => {
    expect(mapSesEvent({ eventType: 'Open', mail })).toEqual([])
    expect(mapSesEvent({ eventType: 'Delivery', delivery: { recipients: ['a@example.org'] } })).toEqual([])
  })
})
