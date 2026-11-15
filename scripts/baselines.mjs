#!/usr/bin/env node
// Regenerates every committed ratchet baseline, in order, and prints which files
// changed (s5-programme.45). It never commits and never stages.
//
//   npm run baselines
//   npm run baselines -- --keep-going    run every generator even after one fails
//
// Every generator runs in its shrink-only mode: a count that FELL is written down,
// a count that ROSE makes the generator refuse (or, for the IDOR snapshot, fail its
// test), and this script exits 1. A rise is a finding to fix, or a decision for a
// person with the generator's own grow flag; it is never taken in here.
//
// On a clean tree that matches its baselines, nothing changes and it says so.
// docs/RUNBOOK-ci-database.md, "Before you push", has the context.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * In order. The static scanners first (they read source only), then the IDOR
 * snapshot, which runs every route handler and takes longest. `gate` runs first
 * when a generator's write mode would also record a rise.
 */
export const GENERATORS = [
  {
    name: 'S5 inventory (service role, events facade, audit coverage)',
    cmd: ['npx', 'tsx', 'scripts/s5-inventory.mjs', '--write'],
    files: ['test/baselines/service-role-files.json', 'test/baselines/sanity-event-getters.json', 'test/baselines/unaudited-mutations.json'],
  },
  {
    name: 'Legacy authorisation idioms',
    cmd: ['npx', 'tsx', 'scripts/authz-idioms.mjs', '--write'],
    files: ['test/baselines/authz-legacy-idioms.json'],
  },
  {
    name: 'Tenant surface (social features a tenant host reaches)',
    cmd: ['npx', 'tsx', 'scripts/tenant-surface-baseline.mjs', '--write'],
    files: ['test/tenant-surface-baseline.json'],
  },
  {
    name: 'Stellr-only admin lists',
    cmd: ['npx', 'vitest', 'run', 'test/stellr-only-lists-ratchet.test.ts'],
    env: { STELLR_ONLY_LISTS_WRITE: '1' },
    files: ['test/baselines/stellr-only-lists.json'],
  },
  {
    // --update-baseline writes whatever it counts, a rise included, so it runs
    // only after the plain lint has passed.
    name: 'Design-system lint',
    gate: ['node', 'scripts/ds-lint.mjs'],
    cmd: ['node', 'scripts/ds-lint.mjs', '--update-baseline'],
    files: ['scripts/ds-lint-baseline.json'],
  },
  {
    name: 'IDOR snapshot and tenant-host baseline',
    cmd: ['npm', 'run', 'idor:snapshot'],
    files: ['test/idor/idor-snapshot.json', 'test/baselines/tenant-host-idor.json'],
  },
]

/** Every baseline the generators own, plus anything else in test/baselines/. */
export function watchedFiles(root = '.') {
  const listed = GENERATORS.flatMap((g) => g.files)
  const dir = `${root}/test/baselines`
  const extra = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `test/baselines/${f}`) : []
  return [...new Set([...listed, ...extra])].sort()
}

function fingerprint(files) {
  return new Map(files.map((f) => [f, existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null]))
}

/** Files whose content differs between two fingerprints. */
export function changedFiles(before, after) {
  return [...after.keys()].filter((f) => before.get(f) !== after.get(f)).sort()
}

function run(cmd, env) {
  return spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...env } }).status
}

function main() {
  const keepGoing = process.argv.includes('--keep-going')
  const files = watchedFiles()
  const before = fingerprint(files)
  const failed = []

  for (const g of GENERATORS) {
    console.log(`\n── ${g.name}`)
    const started = Date.now()
    let status = g.gate ? run(g.gate, g.env) : 0
    if (status === 0) status = run(g.cmd, g.env)
    else console.log(`   ${g.gate.join(' ')} failed, so the baseline was not rewritten.`)
    console.log(`   ${status === 0 ? 'ok' : `FAILED (exit ${status})`} in ${Math.round((Date.now() - started) / 1000)} s`)
    if (status !== 0) {
      failed.push(g.name)
      if (!keepGoing) break
    }
  }

  const changed = changedFiles(before, fingerprint(files))
  console.log('\n── Baselines')
  if (changed.length) {
    console.log('Changed (review, then commit them with the change that moved them):')
    for (const f of changed) console.log(`  ${f}`)
  } else {
    console.log('No baseline changed.')
  }
  if (failed.length) {
    console.error(`\n${failed.length} generator(s) failed: ${failed.join('; ')}.`)
    console.error('A failure here is usually a count that rose. Fix the cause; do not raise the baseline to pass.')
    process.exit(1)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
