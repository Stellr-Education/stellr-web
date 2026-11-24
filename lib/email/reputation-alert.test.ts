import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendEmail = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ id: 'm' })))
vi.mock('@/lib/email', () => ({ sendEmail, teamInboxEmail: () => 'staff@example.test' }))

const { checkTenantReputation } = await import('./reputation-alert')

const T1 = '5e550000-0000-4000-8000-0000000000b1'
const T2 = '5e550000-0000-4000-8000-0000000000b2'
const NOW = new Date('2026-11-23T07:15:00Z')

function db(rows: unknown[], lastAlert: Record<string, string | null> = {}) {
  const upserts: unknown[] = []
  return {
    upserts,
    rpc: async () => ({ data: rows, error: null }),
    from: (table: string) => ({
      select: () => ({
        in: async () =>
          table === 'tenants'
            ? { data: [{ id: T1, display_name: 'Org One' }, { id: T2, display_name: 'Org Two' }], error: null }
            : { data: Object.entries(lastAlert).map(([tenant_id, reputation_alerted_at]) => ({ tenant_id, reputation_alerted_at })), error: null },
      }),
      upsert: async (v: unknown) => (upserts.push(v), { error: null }),
    }),
  }
}

beforeEach(() => sendEmail.mockClear())

describe('checkTenantReputation', () => {
  it('stays quiet when every tenant is under the lines', async () => {
    const d = db([{ tenant_id: T1, reached: 1000, hard_bounces: 5, complaints: 0 }])
    expect(await checkTenantReputation(d as never, NOW)).toEqual({ checked: 1, concerning: 0, alerted: [] })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('emails staff once about tenants over the line, as critical mail, and stamps them', async () => {
    const d = db([
      { tenant_id: T1, reached: 1000, hard_bounces: 60, complaints: 3 },
      { tenant_id: T2, reached: 1000, hard_bounces: 0, complaints: 0 },
    ])
    const out = await checkTenantReputation(d as never, NOW)
    expect(out.alerted).toEqual([T1])
    const msg = sendEmail.mock.calls[0][0] as { to: string; critical: boolean; text: string; subject: string }
    expect(msg).toMatchObject({ to: 'staff@example.test', critical: true })
    expect(msg.subject).toContain('1 organisation needs a look')
    expect(msg.text).toContain('Org One')
    expect(msg.text).not.toContain('Org Two')
    expect(d.upserts[0]).toEqual([expect.objectContaining({ tenant_id: T1, reputation_alerted_at: NOW.toISOString() })])
  })

  it('does not alert again within a week', async () => {
    const d = db([{ tenant_id: T1, reached: 1000, hard_bounces: 60, complaints: 3 }], { [T1]: '2026-11-20T07:15:00Z' })
    expect((await checkTenantReputation(d as never, NOW)).alerted).toEqual([])
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
