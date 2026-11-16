import { auth } from '@clerk/nextjs/server'
import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { grantTier, fireTierPurchased, type GrantTierOptions } from '@/lib/membership-grants'
import { checkTierAllowedForMember } from '@/lib/tiers-server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth } from '@/lib/activity-log'
import { storableId, withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { memberIdOf } from '@/lib/audit-route-helpers'

// POST /api/admin/members/[id]/memberships — admin assigns a tier to a member.
//
// Body:
//   tierId        (required)
//   expiresAt     'YYYY-MM-DD' — explicit expiry; wins over months
//   months        number | null — months until expiry; null = lifetime (no expiry)
//   complimentary boolean — no-charge grant (default true for manual assignment)
//   replacesFree  boolean — expire the member's active FREE memberships first (default true)
//
// Delegates to grantTier() (source='manual') so it shares the idempotency,
// replaces-free behaviour and activity logging of every other grant path.

type Ctx = { params: Promise<{ id: string }> }

// Platform audit (docs/TENANCY-S5.md, C7): the member is the target, the tier's id in
// the metadata.
const grantAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({
  action: 'membership.tier.grant' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'members', id: memberIdOf(req) },
  metadata: auditSubject(req, 'member_memberships').metadata,
})

export const POST = withAudit(grantAudit, assignTier)

async function assignTier(req: Request, { params }: Ctx) {
  const { sessionClaims } = await auth()
  if (!(await hasCapability('members:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: memberId } = await params
  const body = await req.json().catch(() => ({}))
  const { expiresAt, months, complimentary, replacesFree } = body
  let { tierId } = body

  // The admin/access tier chips send the canonical tier NAME (lib/tiers.ts);
  // resolve it to the live tier id here.
  if (!tierId && typeof body.tierName === 'string') {
    const { data: tier } = await supabaseServer()
      .from('membership_tiers').select('id').eq('name', body.tierName).maybeSingle()
    tierId = tier?.id
  }
  if (!tierId) return NextResponse.json({ error: 'tierId required' }, { status: 400 })

  // Bracket compatibility (TIERS_BY_BRACKET) — enforced before any write.
  const bracketCheck = await checkTierAllowedForMember(memberId, tierId)
  if (!bracketCheck.ok) return NextResponse.json({ error: bracketCheck.reason }, { status: 400 })

  noteAuditSubject(req, { detail: { tier_id: storableId(tierId) } })
  const logActor = await actorFromAuth()

  const opts: GrantTierOptions = {
    memberId,
    tierId,
    source: 'manual',
    replacesFree: replacesFree ?? true,
    logActor,
  }
  if ('complimentary' in body) opts.complimentary = !!complimentary
  if (expiresAt) {
    opts.expiresAt = expiresAt
  } else {
    // months: null = lifetime, a number = that many months, absent = default 1yr.
    opts.months = 'months' in body ? (months === null ? null : Number(months)) : 12
  }

  const result = await grantTier(opts)
  if (!result.granted && result.reason === 'already_active') {
    return NextResponse.json(
      { error: 'Member already holds an active membership on this tier.' },
      { status: 409 },
    )
  }
  if (!result.granted) {
    return NextResponse.json({ error: 'Could not assign tier.' }, { status: 400 })
  }
  // Fan-out grant rules (e.g. educator tier → registered students get Pathfinder).
  await fireTierPurchased(memberId, tierId)
  return NextResponse.json(result)
}
