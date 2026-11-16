import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { canManageStoreCatalog } from '@/lib/store/auth'
import {
  deleteDiscount,
  listEventDiscounts,
  listTierDiscounts,
  upsertEventDiscount,
  upsertTierDiscount,
} from '@/lib/store/discounts'
import { storableId, withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

// Both discount axes plus the lookup lists (tiers, products) the editor needs.
export async function GET() {
  if (!(await canManageStoreCatalog('portal:read'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const db = supabaseServer()
    const [tier, event, tiersRes, productsRes] = await Promise.all([
      listTierDiscounts(),
      listEventDiscounts(),
      db.from('membership_tiers').select('id, name').order('sort_order'),
      db.from('store_products').select('id, name').neq('status', 'archived').order('name'),
    ])
    return NextResponse.json({
      tier,
      event,
      tiers: tiersRes.data ?? [],
      products: productsRes.data ?? [],
    })
  } catch (err) {
    console.error('[store/discounts] get:', err)
    return NextResponse.json({ error: 'Could not load discounts' }, { status: 500 })
  }
}

const DISCOUNT_TABLE = { tier: 'store_tier_discounts', event: 'store_event_discounts' } as const

// Platform audit (docs/TENANCY-S5.md, C7): a save names the discount table, its axis,
// scope and percentage, but no row id (an insert returns none, and the body's id is not
// read here); a delete names the row.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'store.discount.save', ...adminAuditSubject(req, 'store_tier_discounts') }),
  saveDiscount,
)
export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'store.discount.delete', ...adminAuditSubject(req, 'store_tier_discounts') }),
  removeDiscount,
)

async function saveDiscount(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const axis = body?.axis
  if (axis !== 'tier' && axis !== 'event') {
    return NextResponse.json({ error: "axis must be 'tier' or 'event'" }, { status: 400 })
  }
  noteAuditSubject(req, {
    table: DISCOUNT_TABLE[axis as keyof typeof DISCOUNT_TABLE],
    detail: {
      axis,
      ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
      ...(typeof body.percent_off === 'number' ? { percent_off: body.percent_off } : {}),
    },
  })
  try {
    if (axis === 'tier') await upsertTierDiscount(body)
    else await upsertEventDiscount(body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/discounts] upsert:', err)
    return NextResponse.json({ error: 'Could not save discount' }, { status: 500 })
  }
}

async function removeDiscount(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(req.url)
  const axis = url.searchParams.get('axis')
  const id = url.searchParams.get('id')
  if ((axis !== 'tier' && axis !== 'event') || !id) {
    return NextResponse.json({ error: 'axis and id required' }, { status: 400 })
  }
  noteAuditSubject(req, { table: DISCOUNT_TABLE[axis], id: storableId(id), detail: { axis } })
  try {
    await deleteDiscount(axis, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/discounts] delete:', err)
    return NextResponse.json({ error: 'Could not delete discount' }, { status: 500 })
  }
}
