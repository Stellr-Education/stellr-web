import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'
import { escapeHtml } from '@/lib/email-layout'
import { getSpaceBySlug, memberCanAccessSpace, memberIsMinor, type CommunityMember } from '@/lib/community'
import { HOUR_MS } from '@/lib/rate-limit'
import { limit } from '@/lib/rate-limit-async'

type TipTapNode = { type?: string; attrs?: Record<string, unknown>; content?: TipTapNode[] }

/**
 * Collect the unique member ids referenced by `mention` nodes inside a stored
 * TipTap document. Safe to call on null/unknown shapes.
 */
export function extractMentionIds(doc: unknown): string[] {
  const ids = new Set<string>()
  const walk = (node: TipTapNode | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'mention') {
      const id = node.attrs?.id
      if (typeof id === 'string' && id) ids.add(id)
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(doc as TipTapNode)
  return [...ids]
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'

// deep review MEM-11: cap the fan-out. One post could carry a `mention` node for
// every directory-visible member, and each one sends a Stellr email — unbounded
// fan-out is a spam / Resend-quota / sender-reputation lever (and a phishing lever
// before PUB-2 escaped the actor name). A legitimate post mentions a handful of
// people; keep the first N distinct recipients and silently ignore the rest.
const MAX_MENTION_RECIPIENTS = 10

// deep review MEM-11 (deep-review-v2.17): the per-post cap above still let one
// actor send unlimited mention emails by spreading them across many posts. Count
// every recipient actually notified against the actor, per hour, on the shared
// limiter (lib/rate-limit-async: in memory by default, Postgres-backed when
// RATE_LIMIT_STORE says so). Thirty an hour is three full posts' worth, far past
// what a real conversation needs.
export const MAX_MENTION_NOTIFICATIONS_PER_HOUR = 30

/**
 * The recipient as the space access resolver needs them, built without a
 * request. memberCanAccessSpace (lib/community.ts) takes a CommunityMember, and
 * the only builder of one, lib/member-session, reads the signed-in Clerk session:
 * it can describe the actor, never a recipient. The resolver behind it
 * (resolveSpaceAccess in lib/spaces) reads only `id`, `isAdmin` and
 * `activeTierIds`; roster rows, global roles and suspensions it loads itself by
 * member id. So this fills `activeTierIds` from member_memberships by the same
 * rule lib/member-session uses (active, and not past its expiry), and leaves the
 * rest empty.
 *
 * `isAdmin` is a Clerk session claim, not a database column, so it is false
 * here. That fails closed: a platform admin who is not otherwise in the space is
 * not emailed about it, which is the cautious way round.
 */
export function mentionRecipientForAccess(memberId: string, activeTierIds: string[]): CommunityMember {
  return {
    id: memberId,
    first_name: null,
    last_name: null,
    email: null,
    isAdmin: false,
    hasPaidTier: false,
    activeTierName: null,
    activeTierIds,
    event_role: null,
    age_bracket: null,
    needsOnboarding: false,
  }
}

/** Active tier ids per member, by lib/member-session's rule. Empty on a failed read: tier access then fails closed. */
async function activeTierIdsByMember(memberIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const { data, error } = await supabaseServer()
    .from('member_memberships')
    .select('member_id, tier_id, expires_at')
    .in('member_id', memberIds)
    .eq('renewal_status', 'active')
  if (error || !data) {
    console.error('[mentions] membership lookup failed; tier-granted space access not counted:', error?.message)
    return out
  }
  const today = new Date().toISOString().split('T')[0]
  for (const row of data as Array<{ member_id: string; tier_id: string | null; expires_at: string | null }>) {
    if (!row.tier_id || (row.expires_at && row.expires_at < today)) continue
    out.set(row.member_id, [...(out.get(row.member_id) ?? []), row.tier_id])
  }
  return out
}

/**
 * The recipients who can open the space, by the rule the space page uses
 * (memberCanAccessSpace → getSpaceAccessById → resolveSpaceAccess). A space that
 * is missing or archived lets nobody in, and a recipient whose check fails is
 * dropped: an email about a post the member cannot open leaks the post's
 * existence and the actor's name.
 */
async function recipientsWithSpaceAccess(memberIds: string[], spaceSlug: string): Promise<string[]> {
  const space = await getSpaceBySlug(spaceSlug)
  if (!space) return []
  const tiers = await activeTierIdsByMember(memberIds)
  const checks = await Promise.all(
    memberIds.map(async (id) => {
      try {
        return (await memberCanAccessSpace(mentionRecipientForAccess(id, tiers.get(id) ?? []), space)) ? id : null
      } catch (e) {
        console.error('[mentions] space access check failed; recipient skipped:', e instanceof Error ? e.message : 'unknown error')
        return null
      }
    }),
  )
  return checks.filter((id): id is string => id !== null)
}

/**
 * The first recipients the actor's hourly budget still covers, in order. Each one
 * is counted as it is let through; the first refusal ends the list, and nothing
 * after it is counted. Logs the actor's member id only.
 */
async function withinActorBudget(actorMemberId: string, recipients: string[]): Promise<string[]> {
  const out: string[] = []
  for (const id of recipients) {
    const decision = await limit(`mentions:actor:${actorMemberId}`, {
      limit: MAX_MENTION_NOTIFICATIONS_PER_HOUR,
      windowMs: HOUR_MS,
      // Not scoped to a tenant: a member id is unique across tenants, so the
      // count is the actor's wherever they post.
      tenantId: null,
    })
    if (!decision.ok) {
      console.warn('[mentions] rate limited', actorMemberId)
      break
    }
    out.push(id)
  }
  return out
}

type NotifyMentionsOptions = {
  mentionIds: string[]
  actorMemberId: string
  actorName: string
  context: 'post' | 'comment'
  postId: string
  spaceSlug: string
  /** Members to skip (e.g. the post author, who already gets a 'reply'). */
  excludeIds?: string[]
}

/**
 * Notify members @mentioned in a post or comment (notification type 'mention',
 * already defined in lib/notify). Best-effort — never throws into the caller.
 *
 * Privacy / safeguarding gate: only members who have opted into the directory
 * (member_directory_prefs.is_visible) are mentionable — the same set the
 * autocomplete offers. Opting out of discoverability therefore also opts out of
 * being mentioned. The server re-validates here because a client could put
 * arbitrary ids in body_json. To loosen this later (e.g. allow mentioning any
 * member who can access the space), change only the visibility query below.
 *
 * In order, a recipient must be: one of the first MAX_MENTION_RECIPIENTS ids,
 * directory-visible, not a minor (MEM-10), able to open the space, and within the
 * actor's hourly budget of MAX_MENTION_NOTIFICATIONS_PER_HOUR (MEM-11).
 */
export async function notifyMentions(opts: NotifyMentionsOptions): Promise<void> {
  // Best-effort: the post or comment is already saved, so nothing here may fail it.
  try {
    await fanOutMentions(opts)
  } catch (e) {
    console.error('[community] mention fan-out failed:', e instanceof Error ? e.message : 'unknown error')
  }
}

async function fanOutMentions(opts: NotifyMentionsOptions): Promise<void> {
  const exclude = new Set([opts.actorMemberId, ...(opts.excludeIds ?? [])])
  // deep review MEM-11: dedupe, drop excluded ids, then cap BEFORE the directory
  // query and the email fan-out so neither grows with the number of mention nodes.
  const candidates = [...new Set(opts.mentionIds)]
    .filter((id) => !exclude.has(id))
    .slice(0, MAX_MENTION_RECIPIENTS)
  if (candidates.length === 0) return

  const db = supabaseServer()
  const { data: visible } = await db
    .from('member_directory_prefs')
    .select('member_id')
    .in('member_id', candidates)
    .eq('is_visible', true)

  let allowed = (visible ?? []).map((r) => r.member_id as string)
  if (allowed.length === 0) return

  // deep review MEM-10 (safeguarding): never email a minor an @mention from an
  // arbitrary adult. Minors are excluded from mention-search, but a stale
  // directory opt-in or a hand-crafted body_json could still name one, so drop
  // any minor recipient here as the server-side backstop.
  const { data: recipientRows, error: recipientErr } = await db
    .from('members')
    .select('id, date_of_birth, age_bracket')
    .in('id', allowed)
  // deep review MEM-N2: fail CLOSED. If the backstop lookup errors (or returns
  // nothing) we cannot tell whether a recipient is a minor, and the old
  // `recipientRows ?? []` treated that as "no minors present" — so a transient DB
  // error plus a stale opt-in could email a minor. Skip the whole fan-out instead.
  if (recipientErr || !recipientRows) {
    console.error('[community] mention recipient lookup failed; skipping fan-out (fail-closed):', recipientErr)
    return
  }
  const minors = new Set(
    recipientRows
      .filter((m) => memberIsMinor(m as { date_of_birth: string | null; age_bracket: string | null }))
      .map((m) => (m as { id: string }).id),
  )
  allowed = allowed.filter((id) => !minors.has(id))
  if (allowed.length === 0) return

  // deep review MEM-11 (deep-review-v2.17): never notify a member about a post in
  // a space they cannot open.
  allowed = await recipientsWithSpaceAccess(allowed, opts.spaceSlug)
  if (allowed.length === 0) return

  // Last, so only recipients who would really be notified count against the actor.
  allowed = await withinActorBudget(opts.actorMemberId, allowed)
  if (allowed.length === 0) return

  const postUrl = `${APP_URL}/community/${opts.spaceSlug}/${opts.postId}`
  const where = opts.context === 'post' ? 'a post' : 'a comment'
  const body = `${opts.actorName} mentioned you in ${where}`
  // deep review PUB-2: `actorName` is a member-chosen display name, so escape
  // the body where it is interpolated into the email HTML below. `body` itself
  // stays raw for the in-app and plain-text channels.
  const bodyHtml = escapeHtml(body)

  await Promise.all(
    allowed.map((id) =>
      notifyMember(id, {
        type: 'mention',
        body,
        actorMemberId: opts.actorMemberId,
        referenceType: 'post',
        referenceId: opts.postId,
        email: {
          subject: body,
          html: `<p>${bodyHtml}.</p><p><a href="${postUrl}">View the conversation</a></p>`,
          text: `${body}. View it: ${postUrl}`,
        },
      }).catch((e) => console.error('[community] mention notify failed:', e)),
    ),
  )
}
