// A supabase-js stand-in on the two-tenant kit's real database (S5 B26), so a
// cron's own queries run against Postgres in CI's tenant-db job, which has no
// PostgREST. It turns the query builder the crons use into SQL, run as
// service_role (the role the app's service-role client has) through the kit's
// owner connection, and logs every table each query touched and whose rows it
// read or wrote.
//
// Only the subset the per-tenant crons use: filtered selects with one level of
// embedding, counts, inserts, updates, upserts, deletes and rpc. Anything else
// throws, so a test cannot pass by a query being quietly ignored. Not a
// PostgREST: values are cast to the column's own type, never interpolated.
//
// The log knows which tenant's turn of a per-tenant run is under way: the
// runner (lib/cron-tenants.ts) writes a child cron_runs row for a tenant before
// its work and finishes that row after, one tenant at a time, so every query
// between the two belongs to that tenant's turn.

import type { SupabaseClient } from '@supabase/supabase-js'
import type postgres from 'postgres'

type Sql = postgres.TransactionSql
type Run = <T>(fn: (sql: Sql) => Promise<T>) => Promise<T>
type Row = Record<string, unknown>

export interface Access {
  table: string
  op: 'select' | 'count' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  /** The tenant whose turn it was, or null outside any tenant's turn. */
  turn: string | null
  /** tenant_id of each row read or written (null where the row has none). Empty for a table without the column. */
  tenants: (string | null)[]
  rpcArgs?: Row
}

export class AccessLog {
  entries: Access[] = []
  turn: string | null = null
  private child: string | null = null
  /** Every tenant whose turn started, in order. */
  turns: string[] = []
  /** Queries this stand-in could not translate. A test asserts there are none. */
  problems: string[] = []

  record(a: Access) {
    this.entries.push(a)
  }
  startTurn(childId: string | null, tenantId: string) {
    this.child = childId
    this.turn = tenantId
    this.turns.push(tenantId)
  }
  endTurn(childId: string) {
    if (this.child === childId) {
      this.child = null
      this.turn = null
    }
  }
  clear() {
    this.entries = []
    this.turns = []
    this.turn = null
    this.child = null
    this.problems = []
  }
}

const IDENT = /^[a-z_][a-z0-9_]*$/

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`rest: not a plain identifier: ${name}`)
  return `"${name}"`
}

// ── Catalog ──────────────────────────────────────────────────────────────────

interface TableInfo {
  types: Map<string, string>
  pk: string[]
}

interface Relation {
  /** true: base holds the foreign key (many-to-one, an object); false: the embedded table does (one-to-many, an array). */
  baseIsChild: boolean
  childCol: string
  parentCol: string
}

class Catalog {
  private tables = new Map<string, Promise<TableInfo>>()
  private relations = new Map<string, Promise<Relation>>()
  private procs = new Map<string, Promise<{ name: string; type: string }[]>>()
  constructor(private run: Run) {}

  table(name: string): Promise<TableInfo> {
    ident(name)
    if (!this.tables.has(name)) {
      this.tables.set(
        name,
        this.run(async (sql) => {
          const cols = await sql<{ name: string; type: string }[]>`
            SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
            FROM pg_attribute a WHERE a.attrelid = ${`public.${name}`}::regclass AND a.attnum > 0 AND NOT a.attisdropped`
          const pk = await sql<{ name: string }[]>`
            SELECT a.attname AS name FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = ${`public.${name}`}::regclass AND i.indisprimary`
          return { types: new Map(cols.map((c) => [c.name, c.type])), pk: pk.map((p) => p.name) }
        }),
      )
    }
    return this.tables.get(name)!
  }

  relation(base: string, embedded: string): Promise<Relation> {
    const key = `${base}>${embedded}`
    if (!this.relations.has(key)) {
      this.relations.set(
        key,
        this.run(async (sql) => {
          const rows = await sql<{ base_is_child: boolean; child_col: string; parent_col: string }[]>`
            SELECT c.conrelid = ${`public.${base}`}::regclass AS base_is_child,
              (SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]) AS child_col,
              (SELECT attname FROM pg_attribute WHERE attrelid = c.confrelid AND attnum = c.confkey[1]) AS parent_col
            FROM pg_constraint c
            WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
              AND ((c.conrelid = ${`public.${base}`}::regclass AND c.confrelid = ${`public.${embedded}`}::regclass)
                OR (c.conrelid = ${`public.${embedded}`}::regclass AND c.confrelid = ${`public.${base}`}::regclass))`
          if (rows.length !== 1) throw new Error(`rest: ${rows.length} foreign keys between ${base} and ${embedded}; expected exactly one`)
          return { baseIsChild: rows[0].base_is_child, childCol: rows[0].child_col, parentCol: rows[0].parent_col }
        }),
      )
    }
    return this.relations.get(key)!
  }

  proc(name: string): Promise<{ name: string; type: string }[]> {
    ident(name)
    if (!this.procs.has(name)) {
      this.procs.set(
        name,
        this.run(async (sql) => {
          const rows = await sql<{ names: string[] | null; types: string[] }[]>`
            SELECT p.proargnames AS names, p.proargtypes::regtype[]::text[] AS types
            FROM pg_proc p WHERE p.proname = ${name} AND p.pronamespace = 'public'::regnamespace`
          if (rows.length !== 1) throw new Error(`rest: ${rows.length} functions named ${name}`)
          const { names, types } = rows[0]
          return types.map((type, i) => ({ name: names?.[i] ?? `$${i + 1}`, type }))
        }),
      )
    }
    return this.procs.get(name)!
  }
}

// ── Values ───────────────────────────────────────────────────────────────────

class Params {
  values: (string | null)[] = []
  /** A value cast to `type`. Every parameter goes as text, so Postgres does the conversion. */
  cast(value: unknown, type: string): string {
    if (type.endsWith('[]')) {
      if (value === null || value === undefined) return `NULL::${type}`
      if (!Array.isArray(value)) throw new Error(`rest: ${type} needs an array`)
      return `ARRAY(SELECT x FROM jsonb_array_elements_text(${this.raw(JSON.stringify(value))}::jsonb) AS t(x))::${type}`
    }
    if (value === null || value === undefined) return `NULL::${type}`
    if (type === 'jsonb' || type === 'json') return `${this.raw(JSON.stringify(value))}::${type}`
    if (typeof value === 'object' && !(value instanceof Date)) throw new Error(`rest: an object for a ${type} column`)
    return `${this.raw(value instanceof Date ? value.toISOString() : String(value))}::${type}`
  }
  /** A list of values of `type`, for IN. */
  list(values: unknown[], type: string): string {
    return `(SELECT x::${type} FROM jsonb_array_elements_text(${this.raw(JSON.stringify(values.map((v) => (v === null ? null : String(v)))))}::jsonb) AS t(x))`
  }
  /**
   * A text parameter. Typed text in the SQL, because postgres.js serialises a
   * parameter by the type the server describes for it: a bare `$1::boolean`
   * would send the string 'true' as false, and `$1::jsonb` would encode the
   * JSON text a second time.
   */
  raw(value: string | null): string {
    this.values.push(value)
    return `$${this.values.length}::text`
  }
}

/** A column, or a JSON path on one (`result->>tenantCursor`), with the type its values compare as. */
function column(alias: string, info: TableInfo, col: string): { expr: string; type: string } {
  const json = /^([a-z_][a-z0-9_]*)(->>?)([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(col)
  if (json) {
    const [, base, arrow, key] = json
    if (!info.types.has(base)) throw new Error(`rest: no column ${base}`)
    return { expr: `(${alias}.${ident(base)}${arrow}'${key}')`, type: arrow === '->>' ? 'text' : 'jsonb' }
  }
  const type = info.types.get(col)
  if (!type) throw new Error(`rest: no column ${col}`)
  return { expr: `${alias}.${ident(col)}`, type }
}

function coerce(raw: string): unknown {
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

// ── Filters ──────────────────────────────────────────────────────────────────

type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'like' | 'ilike'
interface Cond {
  col: string
  op: Op
  value: unknown
  negate: boolean
}
type Filter = { kind: 'cond'; cond: Cond } | { kind: 'or'; conds: Cond[] }

const OPS = new Set<Op>(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike'])

function splitTop(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function parseList(raw: string): unknown[] {
  return raw.replace(/^\(|\)$/g, '').split(',').map((v) => coerce(v.trim().replace(/^"|"$/g, '')))
}

/** `col.op.value` or `col.not.op.value`, as an `or()` clause writes it. */
function parseClause(text: string): Cond {
  const parts = text.split('.')
  const col = parts.shift() as string
  let negate = false
  let op = parts.shift() as Op | 'not'
  if (op === 'not') {
    negate = true
    op = parts.shift() as Op
  }
  if (!OPS.has(op as Op)) throw new Error(`rest: unsupported or() operator ${op}`)
  const raw = parts.join('.')
  return { col, op: op as Op, value: op === 'in' ? parseList(raw) : coerce(raw), negate }
}

function renderCond(c: Cond, alias: string, info: TableInfo, p: Params): string {
  const { expr, type } = column(alias, info, c.col)
  let sql: string
  switch (c.op) {
    case 'is':
      if (c.value !== null && c.value !== true && c.value !== false) throw new Error(`rest: is() takes null, true or false`)
      sql = `${expr} IS ${c.value === null ? 'NULL' : c.value ? 'TRUE' : 'FALSE'}`
      break
    case 'in': {
      const values = c.value as unknown[]
      sql = values.length ? `${expr} IN ${p.list(values, type.replace(/\[\]$/, ''))}` : 'FALSE'
      break
    }
    case 'like':
    case 'ilike':
      sql = `${expr}::text ${c.op === 'like' ? 'LIKE' : 'ILIKE'} ${p.raw(String(c.value))}`
      break
    default: {
      const sym = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[c.op]
      sql = `${expr} ${sym} ${p.cast(c.value, type)}`
    }
  }
  return c.negate ? `NOT (${sql})` : sql
}

function renderFilter(f: Filter, alias: string, info: TableInfo, p: Params): string {
  if (f.kind === 'cond') return renderCond(f.cond, alias, info, p)
  return `(${f.conds.map((c) => renderCond(c, alias, info, p)).join(' OR ')})`
}

// ── Select lists ─────────────────────────────────────────────────────────────

interface Embed {
  key: string
  table: string
  inner: boolean
  columns: string[]
}
interface Projection {
  star: boolean
  columns: string[]
  embeds: Embed[]
}

function parseSelect(text: string): Projection {
  const out: Projection = { star: false, columns: [], embeds: [] }
  for (const item of splitTop(text.replace(/\s+/g, ' '))) {
    const embed = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:!(inner|left))?\((.*)\)$/.exec(item)
    if (embed) {
      const [, alias, table, hint, inner] = embed
      const cols = splitTop(inner)
      if (cols.some((c) => c.includes('('))) throw new Error('rest: nested embeds are not supported')
      out.embeds.push({ key: alias ?? table, table, inner: hint === 'inner', columns: cols })
    } else if (item === '*') out.star = true
    else if (IDENT.test(item)) out.columns.push(item)
    else throw new Error(`rest: unsupported select item "${item}"`)
  }
  return out
}

/** jsonb_build_object over `cols` of `alias`, plus `__t` (tenant_id) where the table has it. */
function objectOf(alias: string, info: TableInfo, cols: string[], star: boolean): string {
  const pairs = cols.flatMap((c) => [`'${c}'`, column(alias, info, c).expr])
  if (info.types.has('tenant_id')) pairs.push(`'__t'`, `${alias}."tenant_id"`)
  const built = pairs.length ? `jsonb_build_object(${pairs.join(', ')})` : `'{}'::jsonb`
  return star ? `(to_jsonb(${alias}) || ${built})` : built
}

/** Strips the `__t` markers, returning the tenants they carried per table. */
function strip(value: unknown, table: string, embeds: Embed[], seen: Map<string, (string | null)[]>): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, table, embeds, seen))
  if (!value || typeof value !== 'object') return value
  const row = { ...(value as Row) }
  if ('__t' in row) {
    seen.set(table, [...(seen.get(table) ?? []), (row.__t as string | null) ?? null])
    delete row.__t
  }
  for (const e of embeds) if (e.key in row) row[e.key] = strip(row[e.key], e.table, [], seen)
  return row
}

// ── The builder ──────────────────────────────────────────────────────────────

type Result = { data: unknown; error: { message: string; code?: string; details?: string } | null; count?: number | null; status: number; statusText: string }

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private projection: Projection | null = null
  private returning = false
  private payload: Row[] = []
  private patch: Row = {}
  private filters: Filter[] = []
  private embedFilters: { embed: string; filter: Filter }[] = []
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = []
  private limitN: number | null = null
  private offsetN = 0
  private cardinality: 'many' | 'single' | 'maybe' = 'many'
  private countMode = false
  private head = false
  private onConflict: string[] | null = null
  private ignoreDuplicates = false

  constructor(
    private table: string,
    private catalog: Catalog,
    private run: Run,
    private log: AccessLog,
  ) {
    ident(table)
  }

  select(columns = '*', opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true
    this.projection = parseSelect(columns)
    if (opts?.count) {
      if (opts.count !== 'exact') throw new Error(`rest: count ${opts.count}`)
      this.countMode = true
      this.head = !!opts.head
    }
    return this
  }
  insert(values: Row | Row[]) {
    this.op = 'insert'
    this.payload = Array.isArray(values) ? values : [values]
    return this
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert'
    this.payload = Array.isArray(values) ? values : [values]
    this.onConflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null
    this.ignoreDuplicates = !!opts?.ignoreDuplicates
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.patch = patch
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }

  private add(col: string, op: Op, value: unknown, negate = false) {
    const dot = col.indexOf('.')
    if (dot !== -1 && !col.includes('->')) {
      this.embedFilters.push({ embed: col.slice(0, dot), filter: { kind: 'cond', cond: { col: col.slice(dot + 1), op, value, negate } } })
    } else this.filters.push({ kind: 'cond', cond: { col, op, value, negate } })
    return this
  }
  eq(c: string, v: unknown) { return this.add(c, 'eq', v) }
  neq(c: string, v: unknown) { return this.add(c, 'neq', v) }
  gt(c: string, v: unknown) { return this.add(c, 'gt', v) }
  gte(c: string, v: unknown) { return this.add(c, 'gte', v) }
  lt(c: string, v: unknown) { return this.add(c, 'lt', v) }
  lte(c: string, v: unknown) { return this.add(c, 'lte', v) }
  like(c: string, v: string) { return this.add(c, 'like', v) }
  ilike(c: string, v: string) { return this.add(c, 'ilike', v) }
  in(c: string, v: readonly unknown[]) { return this.add(c, 'in', [...v]) }
  is(c: string, v: null | boolean) { return this.add(c, 'is', v) }
  match(obj: Row) {
    for (const [k, v] of Object.entries(obj)) this.add(k, 'eq', v)
    return this
  }
  not(c: string, op: string, v: unknown) {
    if (!OPS.has(op as Op)) throw new Error(`rest: unsupported not() operator ${op}`)
    return this.add(c, op as Op, op === 'in' && typeof v === 'string' ? parseList(v) : v, true)
  }
  filter(c: string, op: string, v: unknown) {
    if (op.startsWith('not.')) return this.not(c, op.slice(4), v)
    if (!OPS.has(op as Op)) throw new Error(`rest: unsupported filter() operator ${op}`)
    return this.add(c, op as Op, op === 'in' && typeof v === 'string' ? parseList(v) : v)
  }
  or(expr: string, opts?: { foreignTable?: string; referencedTable?: string }) {
    if (opts?.foreignTable || opts?.referencedTable) throw new Error('rest: or() on an embedded table')
    this.filters.push({ kind: 'or', conds: splitTop(expr).map(parseClause) })
    return this
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string }) {
    if (opts?.foreignTable || opts?.referencedTable) throw new Error('rest: order() on an embedded table')
    this.orders.push({ col, asc: opts?.ascending !== false, nullsFirst: opts?.nullsFirst })
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  range(from: number, to: number) {
    this.offsetN = from
    this.limitN = to - from + 1
    return this
  }
  single() {
    this.cardinality = 'single'
    return this
  }
  maybeSingle() {
    this.cardinality = 'maybe'
    return this
  }
  abortSignal() {
    return this
  }
  returns() {
    return this
  }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected)
  }

  private where(alias: string, info: TableInfo, p: Params): string[] {
    return this.filters.map((f) => renderFilter(f, alias, info, p))
  }

  private async execute(): Promise<Result> {
    try {
      const info = await this.catalog.table(this.table)
      const p = new Params()
      const seen = new Map<string, (string | null)[]>()
      let rows: Row[]
      let count: number | null = null

      if (this.op === 'select') {
        const proj = this.projection ?? parseSelect('*')
        const where = this.where('t', info, p)
        const embedSql: string[] = []
        for (const e of proj.embeds) {
          const einfo = await this.catalog.table(e.table)
          const rel = await this.catalog.relation(this.table, e.table)
          const filters = this.embedFilters.filter((f) => f.embed === e.key).map((f) => renderFilter(f.filter, 'e', einfo, p))
          const join = rel.baseIsChild ? `e.${ident(rel.parentCol)} = t.${ident(rel.childCol)}` : `e.${ident(rel.childCol)} = t.${ident(rel.parentCol)}`
          const cond = [join, ...filters].join(' AND ')
          const obj = objectOf('e', einfo, e.columns.filter((c) => c !== '*'), e.columns.includes('*'))
          embedSql.push(
            `'${e.key}'`,
            rel.baseIsChild
              ? `(SELECT ${obj} FROM public.${ident(e.table)} e WHERE ${cond} LIMIT 1)`
              : `(SELECT coalesce(jsonb_agg(${obj}), '[]'::jsonb) FROM public.${ident(e.table)} e WHERE ${cond})`,
          )
          if (e.inner) where.push(`EXISTS (SELECT 1 FROM public.${ident(e.table)} e WHERE ${cond})`)
        }
        const unknownEmbed = this.embedFilters.find((f) => !proj.embeds.some((e) => e.key === f.embed))
        if (unknownEmbed) throw new Error(`rest: filter on ${unknownEmbed.embed}, which is not embedded`)
        const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
        if (this.countMode) {
          const tenantAgg = info.types.has('tenant_id') ? `, coalesce(jsonb_agg(t."tenant_id"), '[]'::jsonb) AS tenants` : `, '[]'::jsonb AS tenants`
          const [c] = await this.run((sql) => sql.unsafe(`SELECT count(*)::int AS n${tenantAgg} FROM public.${ident(this.table)} t${whereSql}`, p.values as never[]))
          count = c.n as number
          this.log.record({ table: this.table, op: 'count', turn: this.log.turn, tenants: c.tenants as (string | null)[] })
          if (this.head) return { data: null, error: null, count, status: 200, statusText: 'OK' }
        }
        let obj = objectOf('t', info, proj.columns, proj.star)
        if (embedSql.length) obj = `(${obj} || jsonb_build_object(${embedSql.join(', ')}))`
        const orderSql = this.orders.length
          ? ` ORDER BY ${this.orders
              .map((o) => `${column('t', info, o.col).expr} ${o.asc ? 'ASC' : 'DESC'}${o.nullsFirst === undefined ? '' : o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'}`)
              .join(', ')}`
          : ''
        const limitSql = `${this.limitN !== null ? ` LIMIT ${Math.floor(this.limitN)}` : ''}${this.offsetN ? ` OFFSET ${Math.floor(this.offsetN)}` : ''}`
        const out = await this.run((sql) => sql.unsafe(`SELECT ${obj} AS r FROM public.${ident(this.table)} t${whereSql}${orderSql}${limitSql}`, p.values as never[]))
        rows = out.map((r) => strip(r.r, this.table, proj.embeds, seen) as Row)
        for (const [table, tenants] of seen) this.log.record({ table, op: 'select', turn: this.log.turn, tenants })
        if (!seen.has(this.table)) this.log.record({ table: this.table, op: 'select', turn: this.log.turn, tenants: [] })
      } else {
        let text: string
        if (this.op === 'update') {
          const sets = Object.entries(this.patch).map(([k, v]) => `${ident(k)} = ${p.cast(v, info.types.get(k) ?? missing(k))}`)
          if (!sets.length) throw new Error('rest: update() with nothing to set')
          const where = this.where('t', info, p)
          if (!where.length) throw new Error('rest: update() without a filter')
          text = `UPDATE public.${ident(this.table)} AS t SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING to_jsonb(t) AS r`
        } else if (this.op === 'delete') {
          const where = this.where('t', info, p)
          if (!where.length) throw new Error('rest: delete() without a filter')
          text = `DELETE FROM public.${ident(this.table)} AS t WHERE ${where.join(' AND ')} RETURNING to_jsonb(t) AS r`
        } else {
          if (!this.payload.length) return { data: [], error: null, status: 201, statusText: 'Created' }
          const cols = [...new Set(this.payload.flatMap((r) => Object.keys(r)))]
          // PostgREST fills a key one row leaves out with the column default.
          const values = this.payload.map((r) => `(${cols.map((c) => (c in r ? p.cast(r[c], info.types.get(c) ?? missing(c)) : 'DEFAULT')).join(', ')})`)
          text = `INSERT INTO public.${ident(this.table)} AS t (${cols.map(ident).join(', ')}) VALUES ${values.join(', ')}`
          if (this.op === 'upsert') {
            const target = this.onConflict ?? info.pk
            if (!target.length) throw new Error(`rest: upsert into ${this.table} with no conflict target`)
            const rest = cols.filter((c) => !target.includes(c))
            text += this.ignoreDuplicates || !rest.length
              ? ` ON CONFLICT (${target.map(ident).join(', ')}) DO NOTHING`
              : ` ON CONFLICT (${target.map(ident).join(', ')}) DO UPDATE SET ${rest.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')}`
          }
          text += ' RETURNING to_jsonb(t) AS r'
        }
        const out = await this.run((sql) => sql.unsafe(text, p.values as never[]))
        const full = out.map((r) => r.r as Row)
        this.log.record({
          table: this.table,
          op: this.op,
          turn: this.log.turn,
          tenants: info.types.has('tenant_id') ? full.map((r) => (r.tenant_id as string | null) ?? null) : [],
        })
        this.track(full)
        if (!this.returning) return { data: null, error: null, status: this.op === 'insert' ? 201 : 204, statusText: 'OK' }
        const proj = this.projection as Projection
        if (proj.embeds.length) throw new Error('rest: embeds in a mutation result')
        rows = full.map((r) => (proj.star ? r : Object.fromEntries(proj.columns.map((c) => [c, r[c] ?? null]))))
      }

      if (this.cardinality === 'many') return { data: rows, error: null, count, status: 200, statusText: 'OK' }
      if (rows.length > 1 || (this.cardinality === 'single' && rows.length === 0)) {
        return {
          data: null,
          error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` },
          status: 406,
          statusText: 'Not Acceptable',
        }
      }
      return { data: rows[0] ?? null, error: null, count, status: 200, statusText: 'OK' }
    } catch (err) {
      const e = err as { message?: string; code?: string; detail?: string }
      if (e.message?.startsWith('rest:')) {
        this.log.problems.push(`${this.table}: ${e.message}`)
        throw err
      }
      return { data: null, error: { message: e.message ?? String(err), code: e.code, details: e.detail }, status: 400, statusText: 'Bad Request' }
    }
  }

  /** A per-tenant child row opens that tenant's turn; finishing it closes the turn. */
  private track(rows: Row[]) {
    if (this.table !== 'cron_runs') return
    for (const r of rows) {
      if (this.op === 'insert' && r.parent_id && r.tenant_id) this.log.startTurn(r.id as string, r.tenant_id as string)
      if (this.op === 'update' && r.finished_at) this.log.endTurn(r.id as string)
    }
  }
}

function missing(col: string): never {
  throw new Error(`rest: no column ${col}`)
}

/** The client: `from()` and `rpc()` on the kit's database as service_role. Anything else is undefined. */
export function restClient(run: Run, log: AccessLog): SupabaseClient {
  const catalog = new Catalog(run)
  const client = {
    from: (table: string) => new Query(table, catalog, run, log),
    async rpc(fn: string, args: Row = {}) {
      try {
        const params = await catalog.proc(fn)
        const p = new Params()
        const named = Object.entries(args).map(([k, v]) => {
          const param = params.find((x) => x.name === k)
          if (!param) throw new Error(`rest: ${fn} has no argument ${k}`)
          return `${ident(k)} => ${p.cast(v, param.type)}`
        })
        const [row] = await run((sql) => sql.unsafe(`SELECT to_jsonb(public.${ident(fn)}(${named.join(', ')})) AS r`, p.values as never[]))
        log.record({ table: `rpc:${fn}`, op: 'rpc', turn: log.turn, tenants: [], rpcArgs: args })
        return { data: row?.r ?? null, error: null, status: 200, statusText: 'OK' }
      } catch (err) {
        const e = err as { message?: string; code?: string }
        if (e.message?.startsWith('rest:')) {
          log.problems.push(`rpc ${fn}: ${e.message}`)
          throw err
        }
        return { data: null, error: { message: e.message ?? String(err), code: e.code }, status: 400, statusText: 'Bad Request' }
      }
    },
  }
  return client as unknown as SupabaseClient
}
