#!/usr/bin/env node
// Dev migration plan (s5-programme.46, tooling only).
//
// Reads the list of migration versions already recorded in a database's ledger
// (supabase_migrations.schema_migrations), compares it with the files in
// supabase/migrations, and prints:
//   1. the local migration files missing from the ledger, in apply order;
//   2. for each, the exact ledger insert the owner runs AFTER applying that file
//      (with their yes, per the promote skill / docs/RUNBOOK-agent-controls.md).
//
// It NEVER connects to or writes any database. It takes no connection string,
// imports no database driver, and refuses to run if any argument looks like a
// URL (a ledger is a local JSON file the owner exports). Applying is the
// owner's step, not this script's.
//
// Usage:
//   node scripts/dev-migration-plan.mjs --ledger <ledger.json> [--include-legacy] [--migrations-dir <dir>]
//   node scripts/dev-migration-plan.mjs <ledger.json>
//
// The ledger file is the owner's export of
//   select version, name from supabase_migrations.schema_migrations order by version;
// as JSON: an array of version strings, an array of { version, name? } rows, or
// an object with a `versions` / `migrations` / `rows` array of either.
//
// By default only timestamped migrations (14-digit prefix) are planned: they are
// the ones applied on top of supabase/baseline.sql, as CI's `db` job does. The
// historical 001–148 files cannot rebuild the schema (docs/SCHEMA-BASELINE.md);
// --include-legacy lists them too.

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_MIGRATIONS_DIR = 'supabase/migrations'

const TIMESTAMPED = /^(\d{14})_(.+)\.sql$/
const LEGACY = /^(\d{3})_(.+)\.sql$/

export class PlanError extends Error {}

/** Any argument that looks like a URL or a connection option is refused. */
export function refuseDatabaseArgs(argv) {
  for (const arg of argv) {
    const s = String(arg)
    if (/:\/\//.test(s) || /^--?(db|database|db-url|database-url|dsn|connection|conn|url|host|port|password)(=|$)/i.test(s)) {
      throw new PlanError(
        'Refusing to run: an argument looks like a database URL or connection option. ' +
          'This script never connects to a database; pass only a local ledger file (--ledger <file>).',
      )
    }
    if (/^(postgres|postgresql|pg):/i.test(s) || /\bhost=|\bdbname=|\buser=\S+\s*password=/i.test(s)) {
      throw new PlanError('Refusing to run: an argument looks like a database connection string.')
    }
  }
}

export function parseArgs(argv) {
  refuseDatabaseArgs(argv)
  const out = { ledger: null, includeLegacy: false, migrationsDir: DEFAULT_MIGRATIONS_DIR, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') out.help = true
    else if (a === '--include-legacy') out.includeLegacy = true
    else if (a === '--ledger') {
      if (!argv[i + 1]) throw new PlanError('--ledger needs a file path.')
      out.ledger = argv[++i]
    } else if (a.startsWith('--ledger=')) out.ledger = a.slice('--ledger='.length)
    else if (a === '--migrations-dir') {
      if (!argv[i + 1]) throw new PlanError('--migrations-dir needs a directory.')
      out.migrationsDir = argv[++i]
    } else if (a.startsWith('--')) throw new PlanError(`Unknown option: ${a}`)
    else if (out.ledger === null) out.ledger = a
    else throw new PlanError(`Unexpected argument: ${a}`)
  }
  if (!out.help && !out.ledger) throw new PlanError('Pass the ledger export: --ledger <file>.')
  return out
}

/** The set of versions recorded in a ledger export (JSON text). */
export function parseLedger(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new PlanError('The ledger file is not valid JSON.')
  }
  if (data && !Array.isArray(data) && typeof data === 'object') {
    data = data.versions ?? data.migrations ?? data.rows ?? data.data
  }
  if (!Array.isArray(data)) {
    throw new PlanError('The ledger must be a JSON array (or an object with a versions/migrations/rows array).')
  }
  const versions = new Set()
  for (const row of data) {
    const v = typeof row === 'string' || typeof row === 'number' ? String(row) : row && row.version != null ? String(row.version) : null
    if (!v || !/^\d+$/.test(v.trim())) throw new PlanError(`The ledger has an entry that is not a migration version: ${JSON.stringify(row)}`)
    versions.add(v.trim())
  }
  return versions
}

/** Local migration files as { file, version, name }, oldest first. */
export function localMigrations(files, { includeLegacy = false } = {}) {
  const out = []
  for (const file of files) {
    const m = TIMESTAMPED.exec(file) ?? (includeLegacy ? LEGACY.exec(file) : null)
    if (m) out.push({ file, version: m[1], name: m[2] })
  }
  // Legacy 3-digit versions sort before 14-digit ones; within each, numeric order.
  out.sort((a, b) => a.version.length - b.version.length || (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
  const seen = new Map()
  for (const m of out) {
    if (seen.has(m.version)) throw new PlanError(`Two local migrations share version ${m.version}: ${seen.get(m.version)} and ${m.file}`)
    seen.set(m.version, m.file)
  }
  return out
}

export function sqlLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

export function ledgerInsert(m) {
  return `insert into supabase_migrations.schema_migrations (version, name) values (${sqlLiteral(m.version)}, ${sqlLiteral(m.name)});`
}

/**
 * The plan: missing local migrations in apply order, plus warnings for
 * out-of-order files and ledger rows with no local file.
 */
export function buildPlan(local, ledger) {
  const localVersions = new Set(local.map((m) => m.version))
  const missing = local.filter((m) => !ledger.has(m.version))
  const newestApplied = local.filter((m) => ledger.has(m.version)).at(-1)?.version ?? null
  const outOfOrder = newestApplied
    ? missing.filter((m) => m.version.length === newestApplied.length && m.version < newestApplied)
    : []
  const unknown = [...ledger].filter((v) => !localVersions.has(v)).sort()
  return { missing, outOfOrder, unknown, newestApplied }
}

export function renderPlan(plan) {
  const lines = []
  lines.push('Dev migration plan (read-only: nothing was applied, nothing was connected to)')
  lines.push('')
  if (plan.missing.length === 0) {
    lines.push('Every local migration is already in the ledger. Nothing to apply.')
  } else {
    lines.push(`Local migrations missing from the ledger: ${plan.missing.length}`)
    lines.push('')
    lines.push('Apply order:')
    plan.missing.forEach((m, i) => lines.push(`  ${i + 1}. ${m.file}`))
    lines.push('')
    lines.push('After the owner applies each file (with their yes), record it in the ledger:')
    plan.missing.forEach((m, i) => {
      lines.push('')
      lines.push(`-- ${i + 1}. ${m.file}`)
      lines.push(ledgerInsert(m))
    })
  }
  if (plan.outOfOrder.length > 0) {
    lines.push('')
    lines.push(`WARNING: ${plan.outOfOrder.length} missing migration(s) are older than the newest applied one (${plan.newestApplied}):`)
    plan.outOfOrder.forEach((m) => lines.push(`  - ${m.file}`))
    lines.push('Applying them now runs them out of the order CI proved. Check each against the current schema first.')
  }
  if (plan.unknown.length > 0) {
    lines.push('')
    lines.push(`NOTE: ${plan.unknown.length} ledger version(s) have no local file in the planned set:`)
    plan.unknown.forEach((v) => lines.push(`  - ${v}`))
  }
  return lines.join('\n') + '\n'
}

const USAGE = `Usage: node scripts/dev-migration-plan.mjs --ledger <ledger.json> [--include-legacy] [--migrations-dir <dir>]
Never connects to a database. The ledger is a local JSON export of
  select version, name from supabase_migrations.schema_migrations order by version;
`

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, stdout?: { write(s: string): unknown }, stderr?: { write(s: string): unknown } }} [io]
 */
export function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const args = parseArgs(argv)
    if (args.help) {
      stdout.write(USAGE)
      return 0
    }
    const ledger = parseLedger(readFileSync(resolve(cwd, args.ledger), 'utf8'))
    const files = readdirSync(resolve(cwd, args.migrationsDir))
    const local = localMigrations(files, { includeLegacy: args.includeLegacy })
    stdout.write(renderPlan(buildPlan(local, ledger)))
    return 0
  } catch (err) {
    if (err instanceof PlanError) {
      stderr.write(`${err.message}\n`)
      return 2
    }
    if (err && err.code === 'ENOENT') {
      stderr.write(`File not found: ${err.path}\n`)
      return 2
    }
    throw err
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
