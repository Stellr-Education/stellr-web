#!/usr/bin/env node
// Runs, locally, what CI's verify job runs (verify-build and unit), in the same
// order and with the same placeholder environment (s5-programme.45).
//
//   npm run check:pr
//   npm run check:pr -- --keep-going    run every step even after one fails
//   npm run check:pr -- --skip-build    leave out the build and the bundle check
//   npm run check:pr -- --since <ref>   merge base for the caps and lint:pii (default origin/dev)
//
// The environment comes from ci.yml's `&verify-env` block, read at run time, so
// the two cannot drift. Next.js lets process.env win over .env.local, so the build
// sees CI's placeholders, not your own keys. That build is then what .next holds:
// rebuild before `npm start`. test/ci-pr-check.test.ts fails when verify-build
// gains a step this list does not run.
//
// Fetch first (`git fetch origin`): the caps compare with the merge base, and a
// stale origin/dev compares with the wrong one.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CI_FILE = '.github/workflows/ci.yml'

/**
 * The `env: &verify-env` block of ci.yml, as an object.
 * @param {string} ci
 * @returns {Record<string, string>}
 */
export function verifyEnv(ci) {
  const lines = ci.split('\n')
  const start = lines.findIndex((l) => /^\s*env: &verify-env\s*$/.test(l))
  if (start < 0) throw new Error(`${CI_FILE} has no "env: &verify-env" block.`)
  const indent = lines[start].search(/\S/)
  /** @type {Record<string, string>} */
  const env = {}
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue
    if (line.search(/\S/) <= indent) break
    const m = line.match(/^\s*([A-Z0-9_]+):\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  if (!Object.keys(env).length) throw new Error(`${CI_FILE}'s verify-env block holds no variables.`)
  return env
}

/**
 * In verify-build's order, then the unit job. `ci` is the step's `run:` line in
 * ci.yml exactly, or the step's name where its script spans several lines.
 */
export function steps({ since = 'origin/dev', skipBuild = false } = {}) {
  const list = [
    { ci: 'npm run lint:pii', cmd: ['npm', 'run', 'lint:pii', '--', '--base', since] },
    { ci: 'Shell lint (.github/actions scripts)', fn: shellLint },
    { ci: 'npm ci', skip: 'your node_modules are used as they are; run `npm ci` yourself if package-lock.json moved' },
    { ci: 'npx tsc --noEmit', cmd: ['npx', 'tsc', '--noEmit'] },
    { ci: 'npx tsx scripts/authz-idioms.mjs --since origin/dev', cmd: ['npx', 'tsx', 'scripts/authz-idioms.mjs', '--since', since] },
    { ci: 'node scripts/tenant-host-cap.mjs --since origin/dev', cmd: ['node', 'scripts/tenant-host-cap.mjs', '--since', since] },
    { ci: 'node scripts/audit-cap.mjs --since origin/dev', cmd: ['node', 'scripts/audit-cap.mjs', '--since', since] },
    { ci: 'npm run lint:tokens', cmd: ['npm', 'run', 'lint:tokens'] },
    { ci: 'npm run lint:staff-word', cmd: ['npm', 'run', 'lint:staff-word'] },
    { ci: 'npm run lint:migrations', cmd: ['npm', 'run', 'lint:migrations'] },
    { ci: 'npm run lint:ci', cmd: ['npm', 'run', 'lint:ci'] },
    { ci: 'npm run build', cmd: ['npm', 'run', 'build'], build: true },
    { ci: 'Supabase keys in the browser bundle', fn: bundleKeys, build: true },
    // The unit job, which runs beside verify-build in CI.
    { ci: 'npm run test', cmd: ['npm', 'run', 'test'] },
  ]
  return skipBuild ? list.map((s) => (s.build ? { ...s, skip: '--skip-build' } : s)) : list
}

function shellLint(env) {
  if (spawnSync('shellcheck', ['--version'], { stdio: 'ignore' }).error) {
    return { skipped: 'shellcheck is not installed here; CI runs it (brew install shellcheck to run it locally)' }
  }
  const scripts = []
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e.endsWith('.sh')) scripts.push(p)
    }
  }
  walk('.github/actions')
  if (!scripts.length) return { status: 1, message: 'no shell scripts under .github/actions' }
  return { status: spawnSync('shellcheck', scripts.sort(), { stdio: 'inherit', env }).status }
}

/**
 * The same greps as CI's "Supabase keys in the browser bundle": the public
 * placeholder must reach the browser bundle and the server-only one must not.
 * The two values are verify-env's placeholders, never a real key.
 */
const PUBLIC_PLACEHOLDER = 'placeholder-publishable-key'
const SERVER_PLACEHOLDER = 'placeholder-secret-key'

function bundleKeys() {
  const files = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk('.next/static')
  const has = (needle) => files.some((f) => readFileSync(f).includes(needle))
  if (!has(PUBLIC_PLACEHOLDER)) return { status: 1, message: 'the public Supabase key did not reach the browser bundle' }
  if (has(SERVER_PLACEHOLDER)) return { status: 1, message: 'the server-only Supabase key reached the browser bundle' }
  return { status: 0 }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

function main() {
  const keepGoing = process.argv.includes('--keep-going')
  const env = { ...process.env, ...verifyEnv(readFileSync(CI_FILE, 'utf8')) }
  const results = []

  for (const step of steps({ since: arg('--since') ?? 'origin/dev', skipBuild: process.argv.includes('--skip-build') })) {
    if (step.skip) {
      results.push([step.ci, `skipped: ${step.skip}`])
      continue
    }
    console.log(`\n── ${step.ci}`)
    const started = Date.now()
    const r = step.fn ? step.fn(env) : { status: spawnSync(step.cmd[0], step.cmd.slice(1), { stdio: 'inherit', env }).status }
    const secs = Math.round((Date.now() - started) / 1000)
    if (r.skipped) {
      console.log(`   skipped: ${r.skipped}`)
      results.push([step.ci, `skipped: ${r.skipped}`])
      continue
    }
    if (r.message) console.error(`   ${r.message}`)
    results.push([step.ci, r.status === 0 ? `passed (${secs} s)` : `FAILED (exit ${r.status}, ${secs} s)`])
    if (r.status !== 0 && !keepGoing) break
  }

  console.log('\n── check:pr')
  for (const [name, outcome] of results) console.log(`  ${name.padEnd(54)} ${outcome}`)
  if (results.some(([, o]) => o.startsWith('FAILED'))) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
