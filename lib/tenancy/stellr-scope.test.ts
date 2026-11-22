import { describe, expect, it } from 'vitest'
import { STELLR_TENANT_ID } from './constants'
import { rowsOfTenant, STELLR_OR_NULL, tenantRowsOr } from './stellr-scope'

const A = '11111111-1111-4111-8111-111111111111'

describe('tenantRowsOr', () => {
  it('takes Stellr’s rows and rows with no tenant yet for Stellr', () => {
    expect(tenantRowsOr(STELLR_TENANT_ID)).toBe(STELLR_OR_NULL)
  })

  it('takes exactly another tenant’s rows, never NULL', () => {
    expect(tenantRowsOr(A)).toBe(`tenant_id.eq.${A}`)
  })
})

describe('rowsOfTenant', () => {
  const rows = [
    { id: 'unstamped', tenant_id: null },
    { id: 'stellr', tenant_id: STELLR_TENANT_ID },
    { id: 'a', tenant_id: A },
  ]

  it('files NULL under Stellr and leaves another tenant’s row out', () => {
    expect(rowsOfTenant(rows, STELLR_TENANT_ID).map((r) => r.id)).toEqual(['unstamped', 'stellr'])
    expect(rowsOfTenant(rows, A).map((r) => r.id)).toEqual(['a'])
  })

  it('throws on a row read without the column rather than file it under Stellr', () => {
    expect(() => rowsOfTenant([{ id: 'x' } as never], STELLR_TENANT_ID)).toThrow(/select the column/)
  })
})
