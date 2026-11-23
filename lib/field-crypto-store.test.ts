// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
type Mod = typeof import('@/lib/field-crypto-store')
let supabaseDekStore: Mod['supabaseDekStore']

// The module is loaded afresh before each test: its module-level constants
// and tables are evaluated at load, and a mutation run (stryker.config.mjs)
// switches a mutant on only after a file's static imports have run.
beforeEach(async () => {
  vi.resetModules()
  ;({ supabaseDekStore } = await import('@/lib/field-crypto-store'))
})

// A recording stand-in for the PostgREST query builder: every call is logged
// in order, and awaiting the chain resolves to the configured result.
type Call = [string, ...unknown[]]
function fakeDb(result: { data?: unknown; error?: { code?: string } | null }) {
  const calls: Call[] = []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'insert', 'update', 'is']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, ...args])
      return chain
    }
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null })
  const db = {
    from: (table: string) => {
      calls.push(['from', table])
      return chain
    },
  }
  return { db: db as unknown as SupabaseClient, calls }
}

const row = {
  tenant_id: 't1',
  key_id: 'k1',
  master_key_id: 'm1',
  wrapped_dek: 'w',
  created_at: '2026-11-01T00:00:00Z',
  retired_at: null,
}

describe('supabaseDekStore', () => {
  it('listKeys reads one tenant’s keys, oldest first', async () => {
    const { db, calls } = fakeDb({ data: [row] })
    await expect(supabaseDekStore(db).listKeys('t1')).resolves.toEqual([row])
    expect(calls).toEqual([
      ['from', 'tenant_data_keys'],
      ['select', 'tenant_id, key_id, master_key_id, wrapped_dek, created_at, retired_at'],
      ['eq', 'tenant_id', 't1'],
      ['order', 'created_at', { ascending: true }],
    ])
  })

  it('listKeys returns [] when there is no data, and throws with only the code on error', async () => {
    await expect(supabaseDekStore(fakeDb({ data: null }).db).listKeys('t1')).resolves.toEqual([])
    const err = await supabaseDekStore(fakeDb({ error: { code: '42501' } }).db)
      .listKeys('t1')
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('StoreError')
    expect((err as Error).message).toBe('tenant_data_keys request failed (42501)')
  })

  it('an error without a code says unknown', async () => {
    await expect(supabaseDekStore(fakeDb({ error: {} }).db).listKeys('t1')).rejects.toThrow(
      'tenant_data_keys request failed (unknown)',
    )
  })

  it('insertKey: ok, conflict on a unique violation, throws otherwise', async () => {
    const ok = fakeDb({})
    await expect(supabaseDekStore(ok.db).insertKey(row)).resolves.toBe('ok')
    expect(ok.calls).toEqual([
      ['from', 'tenant_data_keys'],
      ['insert', row],
    ])
    await expect(supabaseDekStore(fakeDb({ error: { code: '23505' } }).db).insertKey(row)).resolves.toBe('conflict')
    await expect(supabaseDekStore(fakeDb({ error: { code: '23503' } }).db).insertKey(row)).rejects.toThrow(
      'tenant_data_keys request failed (23503)',
    )
  })

  it('retireKey retires only the live key of that tenant', async () => {
    const { db, calls } = fakeDb({})
    await expect(supabaseDekStore(db).retireKey!('t1', 'k1', '2026-11-22T00:00:00Z')).resolves.toBeUndefined()
    expect(calls).toEqual([
      ['from', 'tenant_data_keys'],
      ['update', { retired_at: '2026-11-22T00:00:00Z' }],
      ['eq', 'tenant_id', 't1'],
      ['eq', 'key_id', 'k1'],
      ['is', 'retired_at', null],
    ])
    await expect(
      supabaseDekStore(fakeDb({ error: { code: 'X' } }).db).retireKey!('t1', 'k1', 'now'),
    ).rejects.toThrow('tenant_data_keys request failed (X)')
  })

  it('updateWrapped re-wraps one key of that tenant', async () => {
    const { db, calls } = fakeDb({})
    await expect(supabaseDekStore(db).updateWrapped!('t1', 'k1', 'm2', 'w2')).resolves.toBeUndefined()
    expect(calls).toEqual([
      ['from', 'tenant_data_keys'],
      ['update', { master_key_id: 'm2', wrapped_dek: 'w2' }],
      ['eq', 'tenant_id', 't1'],
      ['eq', 'key_id', 'k1'],
    ])
    await expect(
      supabaseDekStore(fakeDb({ error: { code: 'Y' } }).db).updateWrapped!('t1', 'k1', 'm2', 'w2'),
    ).rejects.toThrow('tenant_data_keys request failed (Y)')
  })
})
