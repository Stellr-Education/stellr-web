import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { syncFromPrintful } from '@/lib/store/products'
import { printfulEnabled } from '@/lib/store/printful'
import { storableId, withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Import a Printful sync product's variants into this product's variant list.
// Platform audit (docs/TENANCY-S5.md, C7): the product is the target; the Printful
// product and how many variants came in the metadata. A Printful failure is a 502, recorded.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'store.product.printful_sync', ...adminAuditSubject(req, 'store_products') }),
  sync,
)

async function sync(req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!printfulEnabled()) return NextResponse.json({ error: 'Printful not configured' }, { status: 503 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const printfulSyncProductId = Number(body?.printfulSyncProductId)
  if (!printfulSyncProductId) {
    return NextResponse.json({ error: 'printfulSyncProductId required' }, { status: 400 })
  }
  noteAuditSubject(req, { id: storableId(id), detail: { printful_product_id: printfulSyncProductId } })
  try {
    const result = await syncFromPrintful(id, printfulSyncProductId)
    noteAuditSubject(req, { detail: { imported: result.imported } })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[store/sync]:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
