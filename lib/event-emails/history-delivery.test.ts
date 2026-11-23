import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { deliveryFromEvents, loadDeliveryStatus } from './history'

describe('deliveryFromEvents', () => {
  it('a problem beats a success, the furthest success beats a delay', () => {
    expect(deliveryFromEvents([])).toBeNull()
    expect(deliveryFromEvents([
      { type: 'sent', occurred_at: '2026-11-23T10:00:00Z' },
      { type: 'delivery_delayed', occurred_at: '2026-11-23T10:01:00Z' },
      { type: 'delivered', occurred_at: '2026-11-23T10:05:00Z' },
    ])).toEqual({ status: 'delivered', at: '2026-11-23T10:05:00Z' })
    expect(deliveryFromEvents([
      { type: 'delivered', occurred_at: '2026-11-23T10:05:00Z' },
      { type: 'complained', occurred_at: '2026-11-23T11:00:00Z' },
      { type: 'opened', occurred_at: '2026-11-23T12:00:00Z' },
    ])?.status).toBe('complained')
    expect(deliveryFromEvents([
      { type: 'opened', occurred_at: '2026-11-23T12:00:00Z' },
      { type: 'opened', occurred_at: '2026-11-23T13:00:00Z' },
    ])).toEqual({ status: 'opened', at: '2026-11-23T13:00:00Z' })
    expect(deliveryFromEvents([{ type: 'mystery', occurred_at: 'x' }])).toBeNull()
  })
})

describe('loadDeliveryStatus', () => {
  it('reads Resend events for the given ids only', async () => {
    const fake = fakeSupabase({
      email_events: [
        { provider: 'resend', provider_email_id: 're_1', type: 'sent', occurred_at: '2026-11-23T10:00:00Z' },
        { provider: 'resend', provider_email_id: 're_1', type: 'delivered', occurred_at: '2026-11-23T10:01:00Z' },
        { provider: 'resend', provider_email_id: 're_2', type: 'bounced', occurred_at: '2026-11-23T10:02:00Z' },
        { provider: 'resend', provider_email_id: 're_3', type: 'delivered', occurred_at: '2026-11-23T10:02:00Z' },
      ],
    })
    const out = await loadDeliveryStatus(fake.client, ['re_1', 're_2', 're_9', ''])
    expect(Object.fromEntries(out)).toEqual({
      re_1: { status: 'delivered', at: '2026-11-23T10:01:00Z' },
      re_2: { status: 'bounced', at: '2026-11-23T10:02:00Z' },
    })
  })

  it('throws on a failed read', async () => {
    const fake = fakeSupabase({}, { failOn: () => 'down' })
    await expect(loadDeliveryStatus(fake.client, ['re_1'])).rejects.toThrow(/down/)
  })
})
