// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isTenantFlag, TENANT_FLAG_NAMES, TENANT_FLAGS, TenantFlagReadError, tenantFlag, tenantFlags } from './tenant-flags'

// S6-CON-b: the per-tenant switches. Each one has a default, a reader that exists, and
// a place in the table's CHECK list; a missing row is the default.

const db = (answer: { data: unknown; error: unknown }) =>
  ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => answer, then: (ok: (v: unknown) => unknown) => Promise.resolve(answer).then(ok) }
      return q
    },
  }) as never

describe('the registry', () => {
  it('every flag names a reader that exists and mentions the flag', () => {
    for (const f of TENANT_FLAG_NAMES) {
      const src = readFileSync(TENANT_FLAGS[f].reader, 'utf8')
      expect(src, `${f} in ${TENANT_FLAGS[f].reader}`).toContain(`'${f}'`)
    }
  })

  it('the table CHECK lists exactly the registry', () => {
    const file = readdirSync('supabase/migrations').filter((f) => f.endsWith('_console_tenant_errors_flags.sql'))[0]
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
    const listed = /flag\s+text NOT NULL CHECK \(flag IN \(([^)]*)\)\)/.exec(sql)![1].split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(listed.sort()).toEqual([...TENANT_FLAG_NAMES].sort())
  })

  it('isTenantFlag knows the names and nothing else', () => {
    expect(isTenantFlag('break_glass_allowed')).toBe(true)
    expect(isTenantFlag('toString')).toBe(false)
    expect(isTenantFlag(undefined)).toBe(false)
  })
})

describe('reading', () => {
  it('no row: the default', async () => {
    expect(await tenantFlag(db({ data: null, error: null }), 't', 'break_glass_allowed')).toBe(true)
  })
  it('a row: its value', async () => {
    expect(await tenantFlag(db({ data: { enabled: false }, error: null }), 't', 'break_glass_allowed')).toBe(false)
  })
  it('a failed read throws, so the caller fails closed', async () => {
    await expect(tenantFlag(db({ data: null, error: { message: 'down' } }), 't', 'break_glass_allowed')).rejects.toThrow(TenantFlagReadError)
  })
  it('tenantFlags fills defaults and ignores unknown rows', async () => {
    expect(await tenantFlags(db({ data: [{ flag: 'gone', enabled: false }], error: null }), 't')).toEqual({ break_glass_allowed: true })
    expect(await tenantFlags(db({ data: [{ flag: 'break_glass_allowed', enabled: false }], error: null }), 't')).toEqual({ break_glass_allowed: false })
  })
})
