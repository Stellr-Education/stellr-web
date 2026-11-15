// Which capabilities Staff holds that a route handler file checks, read from its source.
//
// The stellr_staff persona (test/idor/harness.ts) is not an admin. On a platform route
// it must be refused at the guard, before the id is used, unless the route checks a
// capability in STAFF_CAPABILITIES: then Staff may pass, and is judged on what it gets.
// Deny by default, as lib/authz/capabilities.ts is: a route that checks no capability, or
// only admin-only ones, is admin-only.
//
// The same reading as test/staff-route-matrix.test.ts (capability literals passed to
// hasCapability / requireCapability and the domain wrappers' defaults), which pins the
// admin-only areas themselves.
import ts from 'typescript'
import { STAFF_CAPABILITIES, type Capability } from '@/lib/authz/capabilities'

const CAP_CALL = new Set(['hasCapability', 'requireCapability', 'requireScholarshipAdmin', 'requireSurveyAdmin', 'canManageStoreCatalog', 'guard', 'requireAdmin'])
const WRAPPER_DEFAULT: Record<string, Capability> = {
  requireScholarshipAdmin: 'scholarships:write',
  requireSurveyAdmin: 'competitions:write',
  canManageStoreCatalog: 'store:write',
}

/** Every capability literal checked under `node`, read the way the matrix reads it. */
function capsUnder(node: ts.Node, out: Set<Capability>, onCall?: (name: string) => void): void {
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : ''
      if (CAP_CALL.has(name)) {
        const lit = n.arguments.find((a) => ts.isStringLiteral(a)) as ts.StringLiteral | undefined
        if (lit) out.add(lit.text as Capability)
        else if (WRAPPER_DEFAULT[name]) out.add(WRAPPER_DEFAULT[name])
      }
      if (ts.isIdentifier(n.expression)) onCall?.(n.expression.text)
    }
    if (ts.isParameter(n) && n.initializer && ts.isStringLiteral(n.initializer) && /:/.test(n.initializer.text)) out.add(n.initializer.text as Capability)
    ts.forEachChild(n, visit)
  }
  visit(node)
}

/** Every capability literal the file checks, whatever the handler. */
export function capabilitiesIn(file: string, source: string): Capability[] {
  const out = new Set<Capability>()
  capsUnder(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), out)
  return [...out].sort()
}

/** The capabilities in STAFF_CAPABILITIES the file checks: empty means admin-only to Staff. */
export function staffCapabilitiesIn(file: string, source: string): Capability[] {
  return capabilitiesIn(file, source).filter((c) => STAFF_CAPABILITIES.includes(c))
}

/**
 * The capabilities in STAFF_CAPABILITIES one exported handler checks: its own body, and
 * the same-file functions it calls (a local `guard()`), followed through. A file whose GET
 * reads with portal:read and whose writes are admin-only is admin-only for those writes.
 */
export function staffCapabilitiesInHandler(file: string, source: string, method: string): Capability[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const local = new Map<string, ts.Node>()
  let handler: ts.Node | undefined
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      local.set(st.name.text, st)
      if (st.name.text === method) handler = st
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        local.set(d.name.text, d.initializer)
        if (d.name.text === method) handler = d.initializer
      }
    }
  }
  if (!handler) throw new Error(`${file} exports no ${method} handler`)
  const out = new Set<Capability>()
  const seen = new Set<string>([method])
  const follow = (n: ts.Node) =>
    capsUnder(n, out, (name) => {
      const fn = local.get(name)
      if (fn && !seen.has(name)) {
        seen.add(name)
        follow(fn)
      }
    })
  follow(handler)
  return [...out].filter((c) => STAFF_CAPABILITIES.includes(c)).sort()
}
