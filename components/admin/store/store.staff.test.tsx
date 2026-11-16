import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import type { StoreProductWithVariants } from '@/lib/store/types'
import { ProductForm } from './ProductForm'
import { DiscountMatrix } from './DiscountMatrix'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

// The store catalogue, prices and discounts are store:write, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const product: StoreProductWithVariants = {
  id: 'p-1',
  slug: 'event-tee',
  name: 'Event Tee',
  description: null,
  product_type: 'apparel',
  status: 'active',
  pod_provider: 'printful' as StoreProductWithVariants['pod_provider'],
  pod_sync_product_id: null,
  images: [],
  is_event_shirt: true,
  featured: false,
  created_at: '2026-01-01T00:00:00Z',
  variants: [
    { id: 'v-1', product_id: 'p-1', sku: 'TEE-L', label: 'Large', options: {}, market_price_cents: 2000, pod_sync_variant_id: null, inventory_qty: null, active: true },
  ],
}

const matrix = (
  <DiscountMatrix
    tier={[{ id: 'td-1', tier_id: 't-1', scope: 'all', product_id: null, category: null, percent_off: 10 }]}
    event={[{ id: 'ed-1', scope: 'global', event_slug: null, product_id: null, category: null, percent_off: 100 }]}
    tiers={[{ id: 't-1', name: 'Explorer' }]}
    products={[{ id: 'p-1', name: 'Event Tee' }]}
    events={[]}
  />
)

describe('Store — admin', () => {
  it('creates a product', () => {
    asAdmin(<ProductForm mode="create" />)
    expect(screen.getByRole('button', { name: /Create product/ })).toBeInTheDocument()
  })
  it('edits a product and its variants', () => {
    asAdmin(<ProductForm mode="edit" product={product} printfulEnabled={false} />)
    expect(screen.getByRole('button', { name: /Save details/ })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Variant 1 SKU' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete variant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add variant/ })).toBeInTheDocument()
    expect(screen.getByText('Printful is not configured in this environment.')).toBeInTheDocument()
  })
  it('adds and deletes discounts', () => {
    asAdmin(matrix)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
    expect(screen.queryByText('An admin sets store discounts.')).toBeNull()
  })
})

describe('Store — Staff', () => {
  it('cannot create a product, and is told an admin does', () => {
    asStaff(<ProductForm mode="create" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('An admin adds products to the store.')).toBeInTheDocument()
  })
  it('sees a product read-only: no save, delete, add or Printful import', () => {
    asStaff(<ProductForm mode="edit" product={product} printfulEnabled />)
    expect(screen.getByText('An admin changes products, prices and variants. You can see them here.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Variant 1 SKU' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Variant 1 SKU' })).toHaveValue('TEE-L')
    expect(screen.queryByRole('button', { name: /Save details/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete variant' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add variant/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Load Printful products/ })).toBeNull()
  })
  it('sees the discounts without delete or add', () => {
    asStaff(matrix)
    expect(screen.getByText('10% off')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByText('An admin sets store discounts.')).toHaveLength(2)
  })
})
