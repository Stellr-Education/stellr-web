import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { archiveProduct, getProduct, updateProduct } from '@/lib/store/products'
import { storableId, withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog('portal:read'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  try {
    const product = await getProduct(id)
    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ product })
  } catch (err) {
    console.error('[store/products/:id] get:', err)
    return NextResponse.json({ error: 'Could not load product' }, { status: 500 })
  }
}

// Platform audit (docs/TENANCY-S5.md, C7): the product is the target; the fields sent
// (names, never values) the metadata.
export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'store.product.update', ...adminAuditSubject(req, 'store_products') }),
  update,
)
export const DELETE = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'store.product.archive', ...adminAuditSubject(req, 'store_products') }),
  archive,
)

async function update(req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  noteAuditSubject(req, { id: storableId(id), detail: { fields: body && typeof body === 'object' ? Object.keys(body) : [] } })
  try {
    await updateProduct(id, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/products/:id] patch:', err)
    return NextResponse.json({ error: 'Could not update product' }, { status: 500 })
  }
}

// Soft delete = archive (retain, hide). Hard purge runs through lib/deletion.
async function archive(req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  noteAuditSubject(req, { id: storableId(id) })
  try {
    await archiveProduct(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/products/:id] archive:', err)
    return NextResponse.json({ error: 'Could not archive product' }, { status: 500 })
  }
}
