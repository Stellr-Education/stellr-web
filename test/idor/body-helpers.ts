// Body fields a route reads through a shared helper it hands its parsed body to.
//
// lib/security/route-ast.ts requestIdInputs reads the fields a route file takes from its
// own body. A route that parses its body and passes it whole to a helper reads its fields
// there, so the route alone shows an empty `body`, and its case sends no id in the body.
// This follows the helpers listed in BODY_HELPERS (reviewed, not every call: a helper that
// starts being followed adds id inputs, which can change outcomes), and the functions in
// the same file the helper hands the body on to. Found as in requestIdInputs: `body.name`,
// `body['name']` and `const { name } = body`; kept as id inputs when isIdLikeName says so,
// the rest returned as fill.
//
// member-merge-school-email.16: the organiser's add-participant route
// (app/api/members/teams/[id]/participants) moved its body reads into
// lib/group-participant-add.ts, and its id-bearing body keys left the snapshot.
import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import type { IdorTarget } from '@/lib/security/idor-targets'
import { isIdLikeName, resolveModule } from '@/lib/security/route-ast'

/** Module id → the exported functions whose body parameter is followed. */
export const BODY_HELPERS: Record<string, readonly string[]> = {
  'lib/group-participant-add': ['addParticipantToGroup'],
}

type Fn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

const parse = (file: string, src: string) => ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** Through `await`, `as`, `!`, `satisfies` and parentheses. */
function strip(e: ts.Expression): ts.Expression {
  let cur = e
  for (;;) {
    if (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression
    else return cur
  }
}

/** `await req.json()`, with any `.catch(…)` / `.then(…)` after it. */
function isBodyRead(e: ts.Expression): boolean {
  let cur = strip(e)
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression) && ['catch', 'then', 'finally'].includes(cur.expression.name.text)) {
    cur = strip(cur.expression.expression)
  }
  return ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression) && ['json', 'formData'].includes(cur.expression.name.text) && cur.arguments.length === 0
}

function walk(n: ts.Node, visit: (n: ts.Node) => void) {
  visit(n)
  ts.forEachChild(n, (c) => walk(c, visit))
}

/** Top-level functions of a file by name: declarations and `const f = (…) => …`. */
function functionsOf(sf: ts.SourceFile): Map<string, Fn> {
  const out = new Map<string, Fn>()
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) out.set(stmt.name.text, stmt)
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) out.set(d.name.text, d.initializer)
      }
    }
  }
  return out
}

/** The fields a function reads from its parameter at `index`, and from same-file functions it passes that parameter to. */
function fieldsReadBy(fns: Map<string, Fn>, name: string, index: number, seen = new Set<string>()): Set<string> {
  const out = new Set<string>()
  const key = `${name}#${index}`
  const fn = fns.get(name)
  if (!fn || seen.has(key)) return out
  seen.add(key)
  const param = fn.parameters[index]
  if (!param || !ts.isIdentifier(param.name) || !fn.body) return out
  const p = param.name.text
  const isP = (e: ts.Expression) => {
    const cur = strip(e)
    return ts.isIdentifier(cur) && cur.text === p
  }
  walk(fn.body, (n) => {
    const isCallee = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n
    if (ts.isPropertyAccessExpression(n) && isP(n.expression) && !isCallee) out.add(n.name.text)
    if (ts.isElementAccessExpression(n) && isP(n.expression) && ts.isStringLiteralLike(n.argumentExpression)) out.add(n.argumentExpression.text)
    if (ts.isVariableDeclaration(n) && n.initializer && isP(n.initializer) && ts.isObjectBindingPattern(n.name)) {
      for (const el of n.name.elements) {
        const k = el.propertyName ?? el.name
        if (ts.isIdentifier(k) || ts.isStringLiteral(k)) out.add(k.text)
      }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && fns.has(n.expression.text)) {
      n.arguments.forEach((a, i) => {
        if (isP(a)) for (const f of fieldsReadBy(fns, (n.expression as ts.Identifier).text, i, seen)) out.add(f)
      })
    }
  })
  return out
}

export interface HelperSource {
  read: (file: string) => string
  exists: (file: string) => boolean
  helpers: Record<string, readonly string[]>
}

const REPO: HelperSource = { read: (f) => readFileSync(f, 'utf8'), exists: existsSync, helpers: BODY_HELPERS }

function readModule(module: string, from: HelperSource): { file: string; src: string } | null {
  for (const ext of ['.ts', '.tsx']) {
    const file = `${module}${ext}`
    if (from.exists(file)) return { file, src: from.read(file) }
  }
  return null
}

/** The body fields a route reads through the helpers in BODY_HELPERS: id-like ones as `body`, the rest as `fill`. */
export function helperBodyInputs(file: string, src: string, from: HelperSource = REPO): { body: string[]; fill: string[] } {
  const sf = parse(file, src)
  const imported = new Map<string, { module: string; name: string }>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.importClause?.isTypeOnly) continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const module = resolveModule(file, stmt.moduleSpecifier.text)
    for (const el of bindings.elements) imported.set(el.name.text, { module, name: (el.propertyName ?? el.name).text })
  }
  const bodyNames = new Set<string>()
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) && isBodyRead(n.initializer)) bodyNames.add(n.name.text)
  })
  const fields = new Set<string>()
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return
    const target = imported.get(n.expression.text)
    if (!target || !from.helpers[target.module]?.includes(target.name)) return
    n.arguments.forEach((a, i) => {
      const cur = strip(a)
      if (!ts.isIdentifier(cur) || !bodyNames.has(cur.text)) return
      const helper = readModule(target.module, from)
      if (!helper) throw new Error(`${file}: body helper ${target.module} not found`)
      for (const f of fieldsReadBy(functionsOf(parse(helper.file, helper.src)), target.name, i)) fields.add(f)
    })
  })
  return { body: [...fields].filter(isIdLikeName).sort(), fill: [...fields].filter((f) => !isIdLikeName(f)).sort() }
}

/** The target with the body fields its helpers read added to its own. */
export function followBodyHelpers<T extends IdorTarget>(t: T, from: HelperSource = REPO): T {
  const extra = helperBodyInputs(t.file, from.read(t.file), from)
  if (!extra.body.length && !extra.fill.length) return t
  const body = [...new Set([...t.body, ...extra.body])].sort()
  const fill = [...new Set([...t.fill, ...extra.fill])].filter((f) => !body.includes(f)).sort()
  return { ...t, body, fill }
}
