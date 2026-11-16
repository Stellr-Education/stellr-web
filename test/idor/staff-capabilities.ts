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
import { resolveModule } from '@/lib/security/route-ast'

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
 * The audit wrappers that call the handler they are given, first, and audit after: the same
 * two lib/security/route-ast.ts reads through (wrappedHandlerOf). Each takes the handler as
 * its second argument. No other wrapper is read through, because nothing says when it calls
 * what it is given: a handler behind one reads as checking nothing, so Staff must be refused.
 */
const AUDIT_WRAPPERS: Record<string, string> = { withAudit: 'lib/audit/route', withCronAudit: 'lib/cron-audit' }

/** Local names bound to an audit wrapper by an import (`import { withAudit as w } …`). */
function auditWrappersIn(sf: ts.SourceFile, file: string): Set<string> {
  const names = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const bindings = st.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const module = resolveModule(file, st.moduleSpecifier.text)
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text
      if (AUDIT_WRAPPERS[imported] === module) names.add(el.name.text)
    }
  }
  return names
}

/** `e` without the parentheses, `as` and `satisfies` around it. */
function strip(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression
  return e
}

/**
 * The capabilities in STAFF_CAPABILITIES one exported handler checks: its own body, and
 * the same-file functions it calls (a local `guard()`), followed through. A file whose GET
 * reads with portal:read and whose writes are admin-only is admin-only for those writes.
 *
 * A handler written `export const POST = withAudit(spec, updateLicense)` (or withCronAudit)
 * is read as `updateLicense`: the wrapper calls it with the request, so what it checks is
 * what the route checks. An inline handler there is read where it stands.
 */
export function staffCapabilitiesInHandler(file: string, source: string, method: string): Capability[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const wrappers = auditWrappersIn(sf, file)
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
  const followName = (name: string) => {
    const fn = local.get(name)
    if (fn && !seen.has(name)) {
      seen.add(name)
      follow(fn)
    }
  }
  const follow = (n: ts.Node): void => {
    capsUnder(n, out, followName)
    // The handler an audit wrapper is given, by name. Inline, capsUnder has read it already.
    const visit = (c: ts.Node) => {
      if (ts.isCallExpression(c)) {
        const callee = strip(c.expression)
        const arg = c.arguments[1] && strip(c.arguments[1])
        if (ts.isIdentifier(callee) && wrappers.has(callee.text) && arg && ts.isIdentifier(arg)) followName(arg.text)
      }
      ts.forEachChild(c, visit)
    }
    visit(n)
  }
  follow(handler)
  return [...out].filter((c) => STAFF_CAPABILITIES.includes(c)).sort()
}
