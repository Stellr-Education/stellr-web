// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-10 (safeguarding): notifyMentions must never email a minor an
// @mention, even if a stale directory opt-in or a hand-crafted body names one.
// deep review MEM-11: the fan-out is capped at MAX_MENTION_RECIPIENTS.
// deep review MEM-N2: a failed minor-backstop lookup fails CLOSED (no fan-out).
// deep-review-v2.17 (MEM-11): a recipient who cannot open the space is never
// notified, and one actor gets at most MAX_MENTION_NOTIFICATIONS_PER_HOUR.
//
// The limiter is the real lib/rate-limit-async in memory mode (RATE_LIMIT_STORE
// unset), whose windows live for the whole file, so each test that counts uses
// an actor id of its own.
const { state } = vi.hoisted(() => ({
  state: {
    visible: [] as Array<{ member_id: string }>,
    members: [] as Array<{ id: string; date_of_birth: string | null; age_bracket: string | null }>,
    membersError: false,
    memberships: [] as Array<{ member_id: string; tier_id: string | null; expires_at: string | null }>,
    /** Space slugs that exist; anything else resolves to no space. */
    spaces: new Set<string>(),
    /** Member ids memberCanAccessSpace lets in (null = everyone). */
    canAccess: null as Set<string> | null,
    accessThrows: false,
    accessCalls: [] as Array<{ id: string; isAdmin: boolean; activeTierIds: string[]; spaceId: string }>,
    notified: [] as string[],
  },
}))

vi.mock('@/lib/community', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/community')>()),
  getSpaceBySlug: async (slug: string) =>
    state.spaces.has(slug)
      ? { id: `space-${slug}`, slug, name: slug, description: null, min_tier_rank: 0, is_archived: false }
      : null,
  memberCanAccessSpace: async (
    member: { id: string; isAdmin: boolean; activeTierIds: string[] },
    space: { id: string },
  ) => {
    state.accessCalls.push({ id: member.id, isAdmin: member.isAdmin, activeTierIds: member.activeTierIds, spaceId: space.id })
    if (state.accessThrows) throw new Error('boom')
    return state.canAccess === null || state.canAccess.has(member.id)
  },
}))

vi.mock('@/lib/notify', () => ({
  notifyMember: async (id: string) => {
    state.notified.push(id)
  },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      if (table === 'member_directory_prefs') {
        // Honour the .in() id list so the MEM-11 cap (which trims the id list
        // BEFORE this query) is observable: only queried ids come back.
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => ({
              eq: async () => ({ data: state.visible.filter((r) => ids.includes(r.member_id)), error: null }),
            }),
          }),
        }
      }
      if (table === 'members') {
        return {
          select: () => ({
            in: async (_c: string, ids: string[]) =>
              state.membersError
                ? { data: null, error: { message: 'boom' } }
                : { data: state.members.filter((m) => ids.includes(m.id)), error: null },
          }),
        }
      }
      if (table === 'member_memberships') {
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => ({
              eq: async () => ({ data: state.memberships.filter((m) => ids.includes(m.member_id)), error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { MAX_MENTION_NOTIFICATIONS_PER_HOUR, notifyMentions } from './mentions'

beforeEach(() => {
  state.visible = []
  state.members = []
  state.membersError = false
  state.memberships = []
  state.spaces = new Set(['general'])
  state.canAccess = null
  state.accessThrows = false
  state.accessCalls = []
  state.notified = []
})

/** Adults, all directory-visible. */
function adults(ids: string[]) {
  state.visible = ids.map((id) => ({ member_id: id }))
  state.members = ids.map((id) => ({ id, date_of_birth: '1990-01-01', age_bracket: 'adult' }))
}

function mention(mentionIds: string[], actorMemberId: string, spaceSlug = 'general') {
  return notifyMentions({
    mentionIds,
    actorMemberId,
    actorName: 'Actor',
    context: 'post',
    postId: 'p1',
    spaceSlug,
  })
}

describe('notifyMentions — minors are never notified', () => {
  it('drops a minor recipient and notifies only the adult', async () => {
    state.visible = [{ member_id: 'adult-1' }, { member_id: 'minor-2' }]
    state.members = [
      { id: 'adult-1', date_of_birth: '1990-01-01', age_bracket: 'adult' },
      { id: 'minor-2', date_of_birth: '2011-01-01', age_bracket: 'high_school' },
    ]
    await notifyMentions({
      mentionIds: ['adult-1', 'minor-2'],
      actorMemberId: 'actor-9',
      actorName: 'Actor',
      context: 'post',
      postId: 'p1',
      spaceSlug: 'general',
    })
    expect(state.notified).toEqual(['adult-1'])
  })
})

describe('notifyMentions — fan-out cap (MEM-11)', () => {
  it('notifies at most 10 recipients even when 25 are mentioned', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `u${i}`)
    state.visible = ids.map((id) => ({ member_id: id }))
    state.members = ids.map((id) => ({ id, date_of_birth: '1990-01-01', age_bracket: 'adult' }))
    await notifyMentions({
      mentionIds: ids,
      actorMemberId: 'actor-9',
      actorName: 'Actor',
      context: 'post',
      postId: 'p1',
      spaceSlug: 'general',
    })
    expect(state.notified).toHaveLength(10)
  })
})

describe('notifyMentions — minor backstop fails closed (MEM-N2)', () => {
  it('sends to nobody when the recipient lookup errors', async () => {
    state.visible = [{ member_id: 'adult-1' }]
    state.membersError = true // the backstop can no longer prove nobody is a minor
    await notifyMentions({
      mentionIds: ['adult-1'],
      actorMemberId: 'actor-9',
      actorName: 'Actor',
      context: 'post',
      postId: 'p1',
      spaceSlug: 'general',
    })
    expect(state.notified).toEqual([])
  })
})

describe('notifyMentions — recipients must be able to open the space (MEM-11)', () => {
  it('does not notify a recipient who cannot access the space', async () => {
    adults(['in-1', 'out-2'])
    state.canAccess = new Set(['in-1'])
    await mention(['in-1', 'out-2'], 'actor-access-1')
    expect(state.notified).toEqual(['in-1'])
    expect(state.accessCalls.map((c) => c.spaceId)).toEqual(['space-general', 'space-general'])
  })

  it('checks access with the recipient’s own active tiers, and never as an admin', async () => {
    adults(['tiered-1'])
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().split('T')[0]
    state.memberships = [
      { member_id: 'tiered-1', tier_id: 'tier-live', expires_at: null },
      { member_id: 'tiered-1', tier_id: 'tier-lapsed', expires_at: yesterday },
    ]
    await mention(['tiered-1'], 'actor-access-2')
    expect(state.accessCalls).toEqual([
      { id: 'tiered-1', isAdmin: false, activeTierIds: ['tier-live'], spaceId: 'space-general' },
    ])
  })

  it('notifies nobody when the space does not resolve (missing or archived)', async () => {
    adults(['a-1'])
    await mention(['a-1'], 'actor-access-3', 'gone')
    expect(state.notified).toEqual([])
  })

  it('drops a recipient whose access check fails, without throwing', async () => {
    adults(['a-1'])
    state.accessThrows = true
    await expect(mention(['a-1'], 'actor-access-4')).resolves.toBeUndefined()
    expect(state.notified).toEqual([])
  })
})

describe('notifyMentions — per-actor hourly limit (MEM-11)', () => {
  it('stops one actor after the limit, across posts, and leaves another actor unaffected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`)
    adults(ids)
    // Four posts of ten mentions each: forty attempts against a budget of thirty.
    for (let post = 0; post < 4; post++) await mention(ids, 'actor-busy')
    expect(state.notified).toHaveLength(MAX_MENTION_NOTIFICATIONS_PER_HOUR)

    // The log names the actor by member id and nothing else.
    const limited = warn.mock.calls.filter((c) => c[0] === '[mentions] rate limited')
    expect(limited.length).toBeGreaterThan(0)
    for (const call of limited) expect(call).toEqual(['[mentions] rate limited', 'actor-busy'])

    state.notified = []
    await mention(ids.slice(0, 3), 'actor-quiet')
    expect(state.notified).toEqual(['r0', 'r1', 'r2'])
    warn.mockRestore()
  })

  it('counts only recipients who would really be notified', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `q${i}`)
    adults(ids)
    // Nobody can open the space, so nothing is notified and nothing is counted.
    state.canAccess = new Set()
    for (let post = 0; post < 5; post++) await mention(ids, 'actor-filtered')
    state.canAccess = null
    await mention(ids, 'actor-filtered')
    expect(state.notified).toHaveLength(10)
  })
})
