import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { createVariant, deleteVariant, updateVariant } from '@/lib/store/products'
import { storableId, withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Variant CRUD for a product. Create with POST; edit with PATCH (variantId in
// body); remove with DELETE (?variantId=).
// Platform audit (docs/TENANCY-S5.md, C7): the variant is the target and its product the
// metadata; an edit adds the fields sent (names, never values).
export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'store.variant.create', ...adminAuditSubject(req, 'store_variants') }),
  create,
)
export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'store.variant.update', ...adminAuditSubject(req, 'store_variants') }),
  update,
)
export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'store.variant.delete', ...adminAuditSubject(req, 'store_variants') }),
  remove,
)

async function create(req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body?.sku || typeof body.market_price_cents !== 'number') {
    return NextResponse.json({ error: 'sku and market_price_cents required' }, { status: 400 })
  }
  try {
    const created = await createVariant(id, {
      sku: body.sku,
      label: body.label ?? null,
      options: body.options ?? {},
      market_price_cents: body.market_price_cents,
      inventory_qty: body.inventory_qty ?? null,
    })
    noteAuditSubject(req, { id: storableId(created.id), detail: { product_id: storableId(id) } })
    return NextResponse.json(created)
  } catch (err) {
    console.error('[store/variants] create:', err)
    return NextResponse.json({ error: 'Could not add variant' }, { status: 500 })
  }
}

async function update(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (!body?.variantId) return NextResponse.json({ error: 'variantId required' }, { status: 400 })
  try {
    const { variantId, ...patch } = body
    noteAuditSubject(req, { id: storableId(variantId), detail: { fields: Object.keys(patch) } })
    await updateVariant(variantId, patch)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/variants] patch:', err)
    return NextResponse.json({ error: 'Could not update variant' }, { status: 500 })
  }
}

async function remove(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const variantId = new URL(req.url).searchParams.get('variantId')
  if (!variantId) return NextResponse.json({ error: 'variantId required' }, { status: 400 })
  noteAuditSubject(req, { id: storableId(variantId) })
  try {
    await deleteVariant(variantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/variants] delete:', err)
    return NextResponse.json({ error: 'Could not delete variant' }, { status: 500 })
  }
}
