import { describe, expect, it } from 'vitest'
import { memberAccountClosed } from './account-closed'

type Row = { id: string; is_active: boolean | null; clerk_user_id?: string | null; email?: string }

function dbOf(rows: Row[]) {
  const writes: string[] = []
  const db = {
    from() {
      const filters: [string, unknown][] = []
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain },
        maybeSingle: async () => ({
          data: rows.find((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)) ?? null,
          error: null,
        }),
        update: () => { writes.push('update'); return chain },
        insert: () => { writes.push('insert'); return chain },
        upsert: () => { writes.push('upsert'); return chain },
      }
      return chain
    },
  }
  return { db: db as never, writes }
}

describe('memberAccountClosed', () => {
  it('is true for a deactivated row whose login link was cleared, found by the verified email', async () => {
    const { db, writes } = dbOf([{ id: 'm-closed', is_active: false, clerk_user_id: null, email: 'closed@example.test' }])
    expect(await memberAccountClosed(db, 'user_placeholder', 'closed@example.test')).toBe(true)
    expect(writes).toEqual([])
  })

  it('is true for a deactivated row still linked to this login', async () => {
    const { db } = dbOf([{ id: 'm-closed', is_active: false, clerk_user_id: 'user_placeholder' }])
    expect(await memberAccountClosed(db, 'user_placeholder', null)).toBe(true)
  })

  it('is false for an active member, and for a login with no row yet', async () => {
    const { db } = dbOf([{ id: 'm-open', is_active: true, clerk_user_id: 'user_placeholder', email: 'open@example.test' }])
    expect(await memberAccountClosed(db, 'user_placeholder', 'open@example.test')).toBe(false)
    expect(await memberAccountClosed(dbOf([]).db, 'user_new_placeholder', 'new@example.test')).toBe(false)
  })
})
