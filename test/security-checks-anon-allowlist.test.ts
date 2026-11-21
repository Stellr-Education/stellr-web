import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The Production migration Action runs supabase/tests/security_checks.sql after each
// apply and rolls back on any row; CI's `db` job runs its pgTAP twin,
// supabase/tests/database/security.test.sql. Nothing ran the first against a database
// in CI, so on 20 Nov 2026 the twin carried the WD-1 exception (tenant_host_map(), the
// one anon-callable SECURITY DEFINER function) and the Action's file did not: production
// refused 20261120185125_tenant_host_map_public. This holds the two lists the same.

const ACTION = readFileSync('supabase/tests/security_checks.sql', 'utf8')
const TWIN = readFileSync('supabase/tests/database/security.test.sql', 'utf8')

/** Function names a file exempts from "anon may execute no definer function". */
function anonExceptions(sql: string): string[] {
  const names = new Set<string>()
  for (const m of sql.matchAll(/p\.proname = '([a-z_]+)'/g)) names.add(m[1])
  for (const m of sql.matchAll(/'public\.([a-z_]+)\(\)'::regprocedure/g)) names.add(m[1])
  return [...names].sort()
}

describe('the anon definer allow-list', () => {
  it('names the same functions in the Action’s check and in its pgTAP twin', () => {
    expect(anonExceptions(ACTION)).toEqual(anonExceptions(TWIN))
  })

  it('is exactly tenant_host_map (WD-1)', () => {
    expect(anonExceptions(ACTION)).toEqual(['tenant_host_map'])
  })
})
