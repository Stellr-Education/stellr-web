// @vitest-environment node
//
// S6-AW gate (docs/PLAN-S6-DRAFT.md, slice table row 3): every mutating handler
// under app/api/admin/** refuses while a support-read session is active. It does
// that by being wrapped in withAudit (lib/audit/route.ts), which calls
// lib/authz/writable's writeRefusal before the handler, or, for a handler that
// audits inline, by calling writeRefusal or assertWritable from lib/authz itself.
//
// It reuses the audit gate's reading of an export (lib/security/audit-coverage.ts,
// isAuditWrapped) rather than a parser of its own. A method exported some way that
// cannot be read (re-exported, destructured) fails closed.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAuditWrapped, MUTATING_METHODS } from '@/lib/security/audit-coverage'
import { analyzeRoute, exportedNames, fileModule } from '@/lib/security/route-ast'

const ADMIN_API = 'app/api/admin'

/** The calls that refuse a support-read write, each with the modules it may come from. */
const WRITABLE_CHECKS: Record<string, readonly string[]> = {
  writeRefusal: ['lib/authz', 'lib/authz/writable'],
  assertWritable: ['lib/authz', 'lib/authz/writable'],
}

/**
 * Mutating admin handlers that need not refuse, by `<file>#<METHOD>`, each with its
 * reason. A test fails on an entry with no real reason, or one that no longer needs it.
 */
const WRITABLE_EXEMPTIONS: Readonly<Record<string, string>> = {
  'app/api/admin/impersonation/route.ts#DELETE':
    'ends view-as: clearing the cookie can only reduce access, so a support-read session must still be able to leave one',
  'app/api/admin/support/consent/route.ts#POST':
    'asks a tenant for break-glass (S6-BG): it records a request the tenant must approve and changes no tenant data, so a support-read session must be able to ask',
  'app/api/admin/support/session/route.ts#DELETE':
    'ends a support session: closing it and clearing its cookie can only reduce access, so a support-read session must still be able to leave',
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) routeFiles(p, out)
    else if (/^route\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

type Verdict = 'wrapped' | 'calls' | 'missing'

/** Each mutating method a route file exports, and how (or whether) it refuses a support-read write. */
function writableVerdicts(file: string, src: string): Map<string, Verdict> {
  const out = new Map<string, Verdict>()
  const mutating = new Set<string>(MUTATING_METHODS)
  const facts = new Map(analyzeRoute(file, src).handlers.map((h) => [h.name, h]))
  const names = new Set([...facts.keys(), ...exportedNames(file, src)])
  for (const method of names) {
    if (method === '*') {
      out.set('*', 'missing')
      continue
    }
    if (!mutating.has(method)) continue
    if (isAuditWrapped(file, src, method)) {
      out.set(method, 'wrapped')
      continue
    }
    const h = facts.get(method)
    const calls =
      !!h &&
      Object.entries(WRITABLE_CHECKS).some(([name, from]) => {
        const got = h.origins.get(name)
        return h.calls.has(name) && !!got && from.some((m) => got.has(fileModule(m)))
      })
    out.set(method, calls ? 'calls' : 'missing')
  }
  return out
}

describe('S6-AW: every mutating admin handler refuses a support-read write', () => {
  const files = routeFiles(ADMIN_API)
  const verdicts = new Map<string, Verdict>()
  for (const file of files) {
    for (const [method, v] of writableVerdicts(file, readFileSync(path.join(process.cwd(), file), 'utf8'))) verdicts.set(`${file}#${method}`, v)
  }

  it('reads the admin API', () => {
    // 181 mutating admin handlers on 22 Nov 2026. A collapse means the walk broke.
    expect(verdicts.size).toBeGreaterThan(150)
    expect([...verdicts.values()].filter((v) => v === 'wrapped').length).toBeGreaterThan(150)
  })

  it('each one is wrapped in withAudit or calls writeRefusal/assertWritable from lib/authz', () => {
    const missing = [...verdicts].filter(([key, v]) => v === 'missing' && !(key in WRITABLE_EXEMPTIONS)).map(([key]) => key)
    expect(missing, 'wrap in withAudit (lib/audit/route.ts), or call writeRefusal from @/lib/authz first').toEqual([])
  })

  it('every exemption has a reason and a live handler that does not already refuse', () => {
    for (const [key, reason] of Object.entries(WRITABLE_EXEMPTIONS)) {
      expect(reason.trim().length, `${key} needs a real reason`).toBeGreaterThan(20)
      expect(verdicts.get(key), `${key} is gone, or refuses now`).toBe('missing')
    }
  })

  describe('the reading itself', () => {
    const F = 'app/api/admin/zz-synthetic/route.ts'
    const verdict = (src: string, method = 'POST') => writableVerdicts(F, src).get(method)

    it('a withAudit export is wrapped', () => {
      expect(
        verdict(`import { withAudit } from '@/lib/audit/route'
          export const POST = withAudit({ action: 'x', actor: { session: true }, tenant: { stellr: true } }, async () => new Response())`),
      ).toBe('wrapped')
    })

    it('a plain handler is missing, and passes once it calls writeRefusal from lib/authz', () => {
      expect(verdict('export async function POST() { return new Response() }')).toBe('missing')
      expect(
        verdict(`import { writeRefusal } from '@/lib/authz'
          export async function POST(req) { const r = writeRefusal(req); if (r) return r; return new Response() }`),
      ).toBe('calls')
      expect(
        verdict(`import { authz } from '@/lib/authz'
          export async function DELETE() { authz.assertWritable(); return new Response() }`, 'DELETE'),
      ).not.toBe('missing')
    })

    it('does not trust a look-alike', () => {
      expect(
        verdict(`import { writeRefusal } from '@/lib/not-authz'
          export async function POST(req) { writeRefusal(req); return new Response() }`),
      ).toBe('missing')
      expect(verdict(`function assertWritable() {}\nexport async function POST() { assertWritable(); return new Response() }`)).toBe('missing')
      expect(
        verdict(`import { withAudit } from '@/lib/not-audit'
          export const POST = withAudit({ action: 'x', actor: { session: true }, tenant: { stellr: true } }, async () => new Response())`),
      ).toBe('missing')
    })

    it('a re-exported handler cannot be read, so it is missing', () => {
      expect(verdict(`export { POST } from './other'`)).toBe('missing')
    })

    it('a GET is not a mutation here', () => {
      expect(writableVerdicts(F, 'export async function GET() { return new Response() }').size).toBe(0)
    })
  })
})
