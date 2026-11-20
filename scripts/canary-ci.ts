/**
 * canary-ci.ts: the driver of CI's `canary-local` job (S5 wave 8, slice K11). It
 * runs K8's canary start phase against the local Supabase stack on the runner,
 * and never against the hosted dev database (WD-8). What it decides is in
 * lib/testing/canary-ci.ts; the job is in .github/workflows/ci.yml.
 *
 *   npx tsx scripts/canary-ci.ts server-env --tag <tag>
 *       KEY=VALUE lines for $GITHUB_ENV: this run's zone (k11-<tag>.localhost), the
 *       tenancy switches the server starts with, and the Sanity stand-in's project.
 *       Reads nothing, writes nothing.
 *
 *   npx tsx scripts/canary-ci.ts seed --zone <zone> --docs <file>
 *       K3's flow seed into the local stack (scripts/seed-two-tenants.ts --profile
 *       flow --apply --clerk-lookup), then its --check, then the stand-in's two event
 *       documents to <file>. Clerk is only read: each persona is looked up by its
 *       address on the dev instance; one that is not there yet (K7a creates them,
 *       with the owner's yes) gets a placeholder id in the local role rows, and no
 *       session later. This file never opens a database client.
 *
 *   npx tsx scripts/canary-ci.ts sanity-stub --docs <file> --cert <file> --key <file> [--port 443]
 *       The Sanity stand-in, on 127.0.0.1 over HTTPS, for k11stub.api.sanity.io
 *       (the job points that name at this machine in /etc/hosts). It serves the two
 *       documents by slug and answers every other query as lib/sanity.ts does
 *       unconfigured: null for a single document (a top-level [0]), [] for a
 *       list. Logs nothing from a query.
 *
 *   npx tsx scripts/canary-ci.ts run --zone <zone> [--port 3000] [--break S1]
 *       Creates a short-lived Clerk session for each persona the dev instance has
 *       (the e2e suite signs its fixtures in the same way), runs
 *       scripts/canary-tenant-flow.ts --phase start --local-stack with them, revokes
 *       them, and judges the report. Exit 1 when the run is red. Writes the verdict
 *       to $GITHUB_STEP_SUMMARY when set.
 *
 * Every subcommand that reads or writes refuses, before it does, any database not on
 * this machine and any Clerk key that is not sk_test_ (as seed-e2e-stack.ts does).
 * No override. Output: hosts, slugs, handles, ids of runs, statuses. No emails.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as https from 'node:https'
import * as os from 'node:os'
import * as path from 'node:path'
import { createClerkClient } from '@clerk/backend'
import {
  answerSanityQuery,
  assertCanaryCiTarget,
  CANARY_CI_MODE,
  CANARY_CI_STELLR_EVENT,
  canaryCiSwitches,
  canaryCiZone,
  judgeCiRun,
  parseRunReport,
  parseSanityRequest,
  sanityStubDocs,
  type SanityStubDoc,
} from '../lib/testing/canary-ci'
import { CANARY_PERSONAS, planCanaryFlowSeed, type CanaryPersonaHandle } from '../lib/testing/canary-flow-seed'
import { sessionIdEnvName } from '../lib/testing/canary-flow-scenarios'

/** `--name value` or `--name=value`; undefined when absent. */
function flagValue(name: string): string | undefined {
  const args = process.argv.slice(3)
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 1)
  const at = args.indexOf(name)
  if (at === -1) return undefined
  const next = args[at + 1]
  return next !== undefined && !next.startsWith('--') ? next : ''
}

function required(name: string): string {
  const v = flagValue(name)
  if (!v) throw new Error(`${name} is required`)
  return v
}

function clerk() {
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
}

/** Each persona's Clerk user id on the dev instance, or null when it has none. Reads only. */
async function lookUpPersonas(): Promise<Map<CanaryPersonaHandle, string | null>> {
  const found = new Map<CanaryPersonaHandle, string | null>()
  const c = clerk()
  for (const p of CANARY_PERSONAS) {
    const { data } = await c.users.getUserList({ emailAddress: [p.email] })
    found.set(p.handle, data[0]?.id ?? null)
  }
  return found
}

function serverEnv(): void {
  const tag = flagValue('--tag') || randomBytes(4).toString('hex')
  // Routing on for the .localhost zone, so canary.<zone> is a tenant host and localhost stays Stellr's.
  const env = { ...canaryCiSwitches(canaryCiZone(tag)), TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.localhost' }
  for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`)
}

/** Runs another script with this env; throws when it fails. */
function runScript(args: string[]): void {
  const r = spawnSync('npx', ['tsx', ...args], { stdio: 'inherit', env: process.env })
  if (r.status !== 0) throw new Error(`${args[0]} exited ${r.status ?? 'without a status'}`)
}

async function seed(): Promise<void> {
  assertCanaryCiTarget(process.env)
  const zone = required('--zone')
  const docsFile = required('--docs')
  // The documents take the mirror row's dates, which the seed takes from its own
  // clock. Planned on either side of it: if Denver's day turned in between, stop.
  const before = planCanaryFlowSeed({ zone })
  runScript(['scripts/seed-two-tenants.ts', '--profile', 'flow', '--zone', zone, '--apply', '--clerk-lookup'])
  runScript(['scripts/seed-two-tenants.ts', '--profile', 'flow', '--zone', zone, '--check'])
  const after = planCanaryFlowSeed({ zone })
  if (before.event.starts_at !== after.event.starts_at) throw new Error("the day turned during the seed, so the event's dates are not certain; re-run the job")

  fs.mkdirSync(path.dirname(docsFile), { recursive: true })
  fs.writeFileSync(docsFile, `${JSON.stringify(sanityStubDocs(after), null, 2)}\n`)
  console.log(`Sanity stand-in documents: ${after.event.slug}, ${CANARY_CI_STELLR_EVENT.slug}`)
}

function sanityStub(): void {
  const docs = JSON.parse(fs.readFileSync(required('--docs'), 'utf8')) as SanityStubDoc[]
  const port = Number(flagValue('--port') || 443)
  const server = https.createServer({ cert: fs.readFileSync(required('--cert')), key: fs.readFileSync(required('--key')) }, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      let status = 200
      let payload: unknown
      try {
        const url = new URL(req.url ?? '/', 'https://stand-in')
        const { query, params } = parseSanityRequest(url.searchParams, req.method === 'POST' && chunks.length ? Buffer.concat(chunks).toString('utf8') : null)
        payload = { ms: 0, query, result: url.pathname.includes('/data/query/') ? answerSanityQuery(query, params, docs) : null }
      } catch {
        status = 400
        payload = { error: 'unreadable query' }
      }
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  server.listen(port, '127.0.0.1', () => console.log(`Sanity stand-in on 127.0.0.1:${port}, ${docs.length} documents`))
}

async function run(): Promise<void> {
  const zone = required('--zone')
  const port = flagValue('--port') || '3000'
  const base = `http://canary.${zone}:${port}`
  const stellrBase = `http://localhost:${port}`
  assertCanaryCiTarget(process.env, { base, stellrBase, connect: '127.0.0.1' })
  const breakFlag = flagValue('--break')

  const personas = await lookUpPersonas()
  const missing = [...personas].filter(([, id]) => !id).map(([h]) => h)
  const sessions: string[] = []
  const env: NodeJS.ProcessEnv = { ...process.env }
  const resultFile = path.join(os.tmpdir(), 'stellr-canary', `ci-${randomBytes(6).toString('hex')}.json`)
  let status: number | null = null
  try {
    for (const [handle, userId] of personas) {
      if (!userId) continue
      const session = await clerk().sessions.createSession({ userId })
      sessions.push(session.id)
      env[sessionIdEnvName(handle)] = session.id
    }
    const args = [
      'tsx', 'scripts/canary-tenant-flow.ts', '--phase', 'start', '--local-stack',
      '--zone', zone, '--base', base, '--stellr-base', stellrBase, '--connect', '127.0.0.1',
      '--stellr-event', CANARY_CI_STELLR_EVENT.slug,
      '--authz-source', CANARY_CI_MODE.authzSource, '--loadscoped-mode', CANARY_CI_MODE.loadScopedMode,
      '--guardian-consent', 'on', '--result-file', resultFile,
      ...(breakFlag ? ['--break', breakFlag] : []),
    ]
    status = spawnSync('npx', args, { stdio: 'inherit', env }).status
  } finally {
    for (const id of sessions) {
      try {
        await clerk().sessions.revokeSession(id)
      } catch {
        console.log('  a persona session could not be revoked; it expires on its own')
      }
    }
  }

  const summary: string[] = ['### Canary on the local stack (K11)', '']
  let ok = false
  if (!fs.existsSync(resultFile)) {
    summary.push(`The runner wrote no report (exit ${status ?? 'none'}): it stopped before the scenarios ran. See the job log.`)
  } else {
    const verdict = judgeCiRun(parseRunReport(JSON.parse(fs.readFileSync(resultFile, 'utf8'))), missing)
    fs.rmSync(resultFile, { force: true })
    ok = verdict.ok
    summary.push('```', ...verdict.lines, '```')
    for (const w of verdict.warnings) console.log(`::warning::${w}`)
  }
  if (breakFlag) summary.push('', `Run with --break ${breakFlag}: red is the expected result.`)
  for (const line of summary) console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`)
  if (!ok) process.exitCode = 1
}

async function main(): Promise<void> {
  const cmd = process.argv[2]
  if (cmd === 'server-env') return serverEnv()
  if (cmd === 'seed') return seed()
  if (cmd === 'sanity-stub') return sanityStub()
  if (cmd === 'run') return run()
  throw new Error('give server-env, seed, sanity-stub or run')
}

main().catch((e) => {
  console.error(`canary-ci: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
