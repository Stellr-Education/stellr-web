// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { steps, verifyEnv } from '../scripts/pr-check.mjs'
import { GENERATORS } from '../scripts/baselines.mjs'

// s5-programme.45: `npm run check:pr` runs what CI's verify job runs. These keep
// the two from drifting: a step added to verify-build or unit that check:pr does
// not know about fails here. Also pins the two CI changes of the ci-tooling slice
// (playwright-apt-offline.8, e2e-local-stack.3).

const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
const job = (name: string) => {
  const start = ci.indexOf(`\n  ${name}:\n`)
  const next = ci.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/)
  return ci.slice(start, next < 0 ? undefined : start + 1 + next)
}

/** Each step's single-line `run:` command, or its name where the script spans lines. */
function ciSteps(body: string): string[] {
  const out: string[] = []
  for (const step of body.split(/\n      - /).slice(1)) {
    const run = step.match(/(?:^|\n)\s*run: (?!\|)(.+)/)
    const name = step.match(/(?:^|\n)\s*name: (.+)/)
    if (run) out.push(run[1].trim())
    else if (/run: \|/.test(step) && name) out.push(name[1].trim())
  }
  return out
}

describe('npm run check:pr mirrors CI verify', () => {
  const known = steps().map((s: { ci: string }) => s.ci)

  it('knows every step verify-build and unit run', () => {
    const wanted = [...ciSteps(job('verify-build')), ...ciSteps(job('unit'))]
    expect(wanted).toContain('npm run build')
    expect(wanted).toContain('npm run test')
    expect(wanted.filter((s) => !known.includes(s))).toEqual([])
  })

  it('runs verify-build in the same order', () => {
    const order = ciSteps(job('verify-build'))
    const mine = known.filter((s: string) => order.includes(s))
    expect(mine).toEqual(order)
  })

  it('takes its environment from the verify-env block, placeholders only', () => {
    const env = verifyEnv(ci)
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe('placeholder-publishable-key')
    expect(env.SUPABASE_SECRET_KEY).toBe('placeholder-secret-key')
    expect(env.CLERK_SECRET_KEY).toBe('sk_test_placeholder')
    for (const value of Object.values(env)) expect(value).not.toMatch(/\$\{\{/)
  })

  it('leaves out only npm ci, and the build pair under --skip-build', () => {
    expect(steps().filter((s: { skip?: string }) => s.skip).map((s: { ci: string }) => s.ci)).toEqual(['npm ci'])
    const skipped = steps({ skipBuild: true }).filter((s: { skip?: string }) => s.skip).map((s: { ci: string }) => s.ci)
    expect(skipped).toEqual(['npm ci', 'npm run build', 'Supabase keys in the browser bundle'])
  })
})

describe('npm run baselines', () => {
  it('runs every generator in a shrink-only mode', () => {
    const commands = GENERATORS.map((g: { cmd: string[] }) => g.cmd.join(' '))
    expect(commands.join('\n')).not.toMatch(/--allow-grow|IDOR_ALLOW_GROW|--seed/)
    const ds = GENERATORS.find((g: { cmd: string[] }) => g.cmd.includes('--update-baseline'))
    expect(ds?.gate).toEqual(['node', 'scripts/ds-lint.mjs'])
  })
})

describe('ci.yml: the ci-tooling slice', () => {
  it('lints the composite actions\' shell scripts in verify-build, before npm ci', () => {
    const body = job('verify-build')
    const lint = body.indexOf('name: Shell lint (.github/actions scripts)')
    expect(lint).toBeGreaterThan(-1)
    expect(lint).toBeLessThan(body.indexOf('- run: npm ci'))
    expect(body.slice(lint)).toMatch(/find \.github\/actions -type f -name '\*\.sh'/)
    expect(body.slice(lint)).toMatch(/shellcheck "\$\{scripts\[@\]\}"/)
  })

  it('summarises skipped tests in both e2e jobs', () => {
    expect(job('e2e-tests')).toContain('node scripts/e2e-report-summary.mjs test-results/e2e-results.json e2e-tests')
    expect(job('e2e-local')).toContain('node scripts/e2e-report-summary.mjs test-results/e2e-results.json e2e-local')
  })
})
