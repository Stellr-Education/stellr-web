// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-6: a moderated post is status='hidden' (not 'deleted'). The
// comment-create path blocked only 'deleted', so a member could keep commenting
// on a hidden post reached by a direct link from an older notification email.
const { state } = vi.hoisted(() => ({
  state: {
    db: null as FakeDb | null,
    mentionIds: [] as string[],
    notifyMentions: [] as Array<Record<string, unknown>>,
    tasks: [] as Promise<unknown>[],
  },
}))

vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => ({ id: 'm1', first_name: 'A', last_name: 'B' }),
  tiptapToPlainText: () => 'hello there',
  communityWriteBlock: async () => null,
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', () => ({ getSpaceAccessById: async () => ({ canAccess: true }), isMemberMutedInSpace: async () => false }))
vi.mock('@/lib/email', () => ({ sendEmail: async () => ({}), communityReplyEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/mentions', () => ({
  extractMentionIds: () => state.mentionIds,
  notifyMentions: async (opts: Record<string, unknown>) => {
    state.notifyMentions.push(opts)
  },
}))
// Collect the after-response work so a test can wait for it.
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    state.tasks.push(task().catch(() => {}))
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { POST } = await import('./route')

const POST_ID = '00000000-0000-4000-8000-0000000000aa'

const post = () =>
  POST(new Request('https://app.test', { method: 'POST', body: JSON.stringify({ postId: POST_ID }) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.mentionIds = []
  state.notifyMentions = []
  state.tasks = []
})

describe('POST comment — post status gate (MEM-6)', () => {
  it('404s a comment on a HIDDEN (moderated) post and inserts nothing', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, status: 'hidden', space_id: null, author_member_id: 'm1' }],
    })
    const res = await post()
    expect(res.status).toBe(404)
    expect(state.db.table('community_comments')).toHaveLength(0)
  })

  it('404s a comment on a DELETED post', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, status: 'deleted', space_id: null, author_member_id: 'm1' }],
    })
    expect((await post()).status).toBe(404)
    expect(state.db.table('community_comments')).toHaveLength(0)
  })

  it('accepts a comment on a PUBLISHED post', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, status: 'published', space_id: null, author_member_id: 'm1' }],
    })
    state.db.rpcs.increment_post_comment_count = () => null
    const res = await post()
    expect(res.status).toBe(200)
    expect(state.db.table('community_comments')).toHaveLength(1)
  })
})

describe('POST comment — comment-count RPC error is surfaced, not swallowed (QUAL-10)', () => {
  // The old `.then(ok, fallback)` swallowed every RPC failure because supabase-js
  // resolves `{ error }` rather than rejecting, so the fallback never ran. The
  // comment still has to be saved (count is best-effort), but the error must now
  // be logged so an out-of-sync count is detectable.
  it('logs the RPC error and still returns the saved comment', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, status: 'published', space_id: null, author_member_id: 'm1' }],
    })
    // No rpc handler registered → the fake resolves `{ data: null, error }`.
    const res = await post()
    expect(res.status).toBe(200)
    expect(state.db.table('community_comments')).toHaveLength(1)
    expect(errSpy).toHaveBeenCalledWith(
      '[community] increment_post_comment_count failed:',
      expect.objectContaining({ message: expect.stringContaining('increment_post_comment_count') }),
    )
    errSpy.mockRestore()
  })
})

// #727 follow-up: the per-recipient mention access check runs against the
// post's own space. When that space cannot be read, nobody is notified (the old
// code fell back to 'general', letting every member who can open it through).
describe('POST comment — mentions are checked against the post’s own space', () => {
  const PRIVATE_SPACE = '00000000-0000-4000-8000-0000000000b1'
  const GENERAL_SPACE = '00000000-0000-4000-8000-0000000000b2'

  async function commentMentioning(postRow: Record<string, unknown>, failSecondRead = false) {
    let postReads = 0
    state.db = fakeSupabase(
      { community_posts: [{ id: POST_ID, status: 'published', author_member_id: 'author-1', ...postRow }] },
      {
        failOn: (table, action) => {
          if (table !== 'community_posts' || action !== 'select') return null
          postReads++
          // The gate read and the reply notice succeed; the mention read fails.
          return failSecondRead && postReads > 2 ? 'permission denied' : null
        },
      },
    )
    state.db.rpcs.increment_post_comment_count = () => null
    state.mentionIds = ['mentioned-1']
    const res = await post()
    await Promise.all(state.tasks)
    return res
  }

  it('a post in a private space passes that space’s id and slug, not general', async () => {
    const res = await commentMentioning({ space_id: PRIVATE_SPACE, community_spaces: { slug: 'team-private' } })
    expect(res.status).toBe(200)
    expect(state.notifyMentions).toHaveLength(1)
    expect(state.notifyMentions[0]).toMatchObject({
      mentionIds: ['mentioned-1'],
      context: 'comment',
      postId: POST_ID,
      spaceId: PRIVATE_SPACE,
      spaceSlug: 'team-private',
      excludeIds: ['author-1'],
    })
  })

  it('a post in the general space is checked against the general space by id', async () => {
    await commentMentioning({ space_id: GENERAL_SPACE, community_spaces: [{ slug: 'general' }] })
    expect(state.notifyMentions).toHaveLength(1)
    expect(state.notifyMentions[0]).toMatchObject({ spaceId: GENERAL_SPACE, spaceSlug: 'general' })
  })

  it('sends no mention notifications, and logs it, when the post’s space cannot be read', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The space row is not readable: the embed comes back empty.
    const res = await commentMentioning({ space_id: PRIVATE_SPACE, community_spaces: null })
    expect(res.status).toBe(200)
    expect(state.db!.table('community_comments')).toHaveLength(1)
    expect(state.notifyMentions).toEqual([])
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('comment mentions skipped'),
      expect.objectContaining({ postId: POST_ID }),
    )
    errSpy.mockRestore()
  })

  it('sends no mention notifications when the read of the post’s space errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await commentMentioning({ space_id: PRIVATE_SPACE, community_spaces: { slug: 'team-private' } }, true)
    expect(res.status).toBe(200)
    expect(state.notifyMentions).toEqual([])
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('comment mentions skipped'), expect.anything())
    errSpy.mockRestore()
  })
})
