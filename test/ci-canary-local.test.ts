// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// S5 wave 8, K11: the canary-local job runs K8's canary on the runner's own
// Supabase stack and never on the hosted dev database (WD-8). It is report-only
// and not required until the owner makes it so. These pin both.

const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
/** A job's block of the workflow, from its key to the next job's. */
const jobBlock = (name: string) => {
  const start = ci.indexOf(`\n  ${name}:\n`)
  if (start < 0) return ''
  const next = ci.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/)
  return ci.slice(start, next < 0 ? undefined : start + 1 + next)
}
const job = jobBlock('canary-local')
const jobNames = [...ci.matchAll(/\n  ([a-z][a-z0-9-]*):\n/g)].map((m) => m[1])

describe('ci.yml canary-local (K11)', () => {
  it('exists and runs the canary driver against the local stack', () => {
    expect(job).toContain('name: canary-local')
    expect(job).toContain('supabase start')
    expect(job).toContain('bash scripts/e2e-stack-db.sh')
    expect(job).toContain('scripts/canary-ci.ts seed')
    expect(job).toContain('scripts/canary-ci.ts run')
  })

  it('holds no hosted Supabase secret, and stops on a stack URL off this machine', () => {
    expect(job).not.toMatch(/secrets\.[A-Z_]*SUPABASE/)
    expect(job).toContain('http://127.0.0.1:*) ;;')
    expect(job).toContain("The local stack's API URL is not on this machine.")
  })

  it('is report-only until the owner sets CANARY_LOCAL_ENFORCE', () => {
    expect(job).toContain("continue-on-error: ${{ vars.CANARY_LOCAL_ENFORCE != 'true' }}")
  })

  it('is not needed by any other job, so it gates nothing yet', () => {
    expect(jobNames).toContain('canary-local')
    for (const name of jobNames) {
      const needs = jobBlock(name).match(/\n    needs: (.+)/)?.[1] ?? ''
      expect(needs, name).not.toMatch(/canary-local/)
    }
  })
})
