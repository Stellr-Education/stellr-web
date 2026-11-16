import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { createProduct, listProducts } from '@/lib/store/products'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

// Admin catalog: list all products (with variants), create a new draft product.
export async function GET() {
  if (!(await canManageStoreCatalog('portal:read'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const products = await listProducts()
    return NextResponse.json({ products })
  } catch (err) {
    console.error('[store/products] list:', err)
    return NextResponse.json({ error: 'Could not load products' }, { status: 500 })
  }
}

// Platform audit (docs/TENANCY-S5.md, C7): the new product is the target, never its name.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'store.product.create', ...adminAuditSubject(req, 'store_products') }),
  create,
)

async function create(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (!body?.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  try {
    const { id } = await createProduct({
      name: body.name,
      product_type: body.product_type,
      description: body.description ?? null,
    })
    noteAuditSubject(req, { id })
    return NextResponse.json({ id })
  } catch (err) {
    console.error('[store/products] create:', err)
    return NextResponse.json({ error: 'Could not create product' }, { status: 500 })
  }
}
