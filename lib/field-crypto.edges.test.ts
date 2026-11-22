// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type DataKey, type DekRow, type DekStore, type MasterKeyring } from '@/lib/field-crypto'
type Mod = typeof import('@/lib/field-crypto')
let ACTIVE_CHECK_MS: Mod['ACTIVE_CHECK_MS']
let BIDX_VERSION: Mod['BIDX_VERSION']
let FIELD_CRYPTO_MODES: Mod['FIELD_CRYPTO_MODES']
let FIELD_VERSION: Mod['FIELD_VERSION']
let FieldCrypto: Mod['FieldCrypto']
let FieldCryptoError: Mod['FieldCryptoError']
let KEY_ID_PATTERN: Mod['KEY_ID_PATTERN']
let WRAP_VERSION: Mod['WRAP_VERSION']
let blindIndex: Mod['blindIndex']
let blindIndexEquals: Mod['blindIndexEquals']
let decryptField: Mod['decryptField']
let encryptField: Mod['encryptField']
let fieldCryptoActive: Mod['fieldCryptoActive']
let fieldCryptoMode: Mod['fieldCryptoMode']
let fieldKeyId: Mod['fieldKeyId']
let isFieldCiphertext: Mod['isFieldCiphertext']
let loadMasterKeyring: Mod['loadMasterKeyring']
let newDekId: Mod['newDekId']
let normaliseForIndex: Mod['normaliseForIndex']
let rewrapDek: Mod['rewrapDek']
let unwrapDek: Mod['unwrapDek']
let wrapDek: Mod['wrapDek']
let wrappedMasterId: Mod['wrappedMasterId']

// The module is loaded afresh before each test: its module-level constants
// and tables are evaluated at load, and a mutation run (stryker.config.mjs)
// switches a mutant on only after a file's static imports have run.
beforeEach(async () => {
  vi.resetModules()
  ;({ ACTIVE_CHECK_MS, BIDX_VERSION, FIELD_CRYPTO_MODES, FIELD_VERSION, FieldCrypto, FieldCryptoError, KEY_ID_PATTERN, WRAP_VERSION, blindIndex, blindIndexEquals, decryptField, encryptField, fieldCryptoActive, fieldCryptoMode, fieldKeyId, isFieldCiphertext, loadMasterKeyring, newDekId, normaliseForIndex, rewrapDek, unwrapDek, wrapDek, wrappedMasterId } = await import('@/lib/field-crypto'))
})
import { sealGcm } from '@/lib/esign/backup-crypto'

// The edges of lib/field-crypto.ts: the fixed error messages, configuration
// parsing, the dotted formats, the input checks bound into the AAD, the blind
// index normalisers, and the service's cache and store handling.
// (field-crypto.test.ts covers the round trips and the rotations.)

const TENANT = '00000000-0000-4000-8000-000000000001'
const ROW = '11111111-2222-4333-8444-555555555555'
const ctx = { tenantId: TENANT, table: 'participants', column: 'health_conditions', rowId: ROW }
const key32 = () => randomBytes(32)
const dek = (keyId = 'dk-1'): DataKey => ({ keyId, key: key32() })
const ring = (): MasterKeyring => ({ current: { id: 'mk-a', key: key32() } })

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(FieldCryptoError)
    return (e as { code: string }).code
  }
  return undefined
}

describe('constants and errors', () => {
  it('versions, modes, key id pattern and active-check default', () => {
    expect([FIELD_VERSION, WRAP_VERSION, BIDX_VERSION]).toEqual(['sf1', 'wk1', 'bi1'])
    expect(FIELD_CRYPTO_MODES).toEqual(['off', 'shadow', 'read'])
    expect(ACTIVE_CHECK_MS).toBe(30_000)
    expect(KEY_ID_PATTERN.test('a'.repeat(32))).toBe(true)
    expect(KEY_ID_PATTERN.test('a'.repeat(33))).toBe(false)
    expect(KEY_ID_PATTERN.test('')).toBe(false)
    expect(KEY_ID_PATTERN.test('a.b')).toBe(false)
    expect(KEY_ID_PATTERN.test('A-z_9')).toBe(true)
  })

  it('every code has its own fixed message and the error is named', () => {
    const messages = {
      config: 'Field encryption is misconfigured',
      format: 'Not a recognised field-encryption value',
      auth: 'Encrypted value could not be authenticated',
      no_key: 'The key for this value is not available',
      store: 'The data-key store could not be read or written',
      input: 'Invalid field-encryption input',
    } as const
    for (const [code, message] of Object.entries(messages)) {
      const e = new FieldCryptoError(code as keyof typeof messages)
      expect(e.message).toBe(message)
      expect(e.code).toBe(code)
      expect(e.name).toBe('FieldCryptoError')
    }
  })
})

describe('configuration', () => {
  const k = () => key32().toString('base64')

  it('mode is trimmed and lower-cased', () => {
    expect(fieldCryptoMode({ FIELD_CRYPTO_MODE: '  Shadow ' })).toBe('shadow')
    expect(fieldCryptoMode({ FIELD_CRYPTO_MODE: 'READ' })).toBe('read')
    expect(fieldCryptoMode({ FIELD_CRYPTO_MODE: 'on' })).toBe('off')
    expect(fieldCryptoMode({})).toBe('off')
  })

  it('fieldCryptoActive needs a mode and a good key, and never throws', () => {
    expect(fieldCryptoActive({ FIELD_CRYPTO_MODE: 'read', FIELD_CRYPTO_MASTER_KEY: k(), FIELD_CRYPTO_KEY_ID: 'mk' })).toBe(true)
    expect(fieldCryptoActive({ FIELD_CRYPTO_MODE: 'shadow' })).toBe(false)
    expect(fieldCryptoActive({ FIELD_CRYPTO_MODE: 'shadow', FIELD_CRYPTO_MASTER_KEY: 'bad', FIELD_CRYPTO_KEY_ID: 'mk' })).toBe(false)
  })

  it('trims the key and the id, and keeps the id', () => {
    const raw = key32()
    const r = loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: ` ${raw.toString('base64')}\n`, FIELD_CRYPTO_KEY_ID: ' mk-1 ' })
    expect(r?.current.id).toBe('mk-1')
    expect(r?.current.key.equals(raw)).toBe(true)
    expect(r?.previous).toBeUndefined()
    expect(Object.keys(r!)).toEqual(['current'])
  })

  it('refuses a key without an id, an id without a key, a bad id, non-base64 or a wrong length', () => {
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: k() }))).toBe('config')
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_KEY_ID: 'mk' }))).toBe('config')
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: k(), FIELD_CRYPTO_KEY_ID: 'm.k' }))).toBe('config')
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: `${k()}x`, FIELD_CRYPTO_KEY_ID: 'mk' }))).toBe('config')
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: `!${k()}`, FIELD_CRYPTO_KEY_ID: 'mk' }))).toBe('config')
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: `${k()}===`, FIELD_CRYPTO_KEY_ID: 'mk' }))).toBe('config')
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: randomBytes(31).toString('base64'), FIELD_CRYPTO_KEY_ID: 'mk' }))).toBe('config')
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: randomBytes(33).toString('base64'), FIELD_CRYPTO_KEY_ID: 'mk' }))).toBe('config')
  })

  it('a previous key alone, or sharing the current id, is misconfigured; a distinct one loads', () => {
    expect(codeOf(() => loadMasterKeyring({ FIELD_CRYPTO_PREVIOUS_MASTER_KEY: k(), FIELD_CRYPTO_PREVIOUS_KEY_ID: 'old' }))).toBe('config')
    expect(
      codeOf(() =>
        loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: k(), FIELD_CRYPTO_KEY_ID: 'mk', FIELD_CRYPTO_PREVIOUS_MASTER_KEY: k(), FIELD_CRYPTO_PREVIOUS_KEY_ID: 'mk' }),
      ),
    ).toBe('config')
    const r = loadMasterKeyring({ FIELD_CRYPTO_MASTER_KEY: k(), FIELD_CRYPTO_KEY_ID: 'mk', FIELD_CRYPTO_PREVIOUS_MASTER_KEY: k(), FIELD_CRYPTO_PREVIOUS_KEY_ID: 'old' })
    expect(r?.previous?.id).toBe('old')
  })
})

describe('dotted formats', () => {
  it('a field value is sf1.<dek id>.<base64url>, and its key id reads back', () => {
    const d = dek('dk-9')
    const c = encryptField(d, ctx, 'x')
    expect(c.startsWith('sf1.dk-9.')).toBe(true)
    expect(c.split('.')[2]).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(fieldKeyId(c)).toBe('dk-9')
    expect(isFieldCiphertext(c)).toBe(true)
  })

  it('refuses a wrong version, too few or too many parts, a bad key id or a body that is not base64url', () => {
    const c = encryptField(dek('dk-9'), ctx, 'x')
    const [, id, body] = c.split('.')
    for (const bad of [`sf2.${id}.${body}`, `sf1.${id}`, `${c}.x`, `sf1.d!k.${body}`, `sf1..${body}`, `sf1.${id}.${body}=`, `sf1.${id}.`]) {
      expect(isFieldCiphertext(bad), bad).toBe(false)
      expect(codeOf(() => fieldKeyId(bad)), bad).toBe('format')
    }
    expect(isFieldCiphertext(42)).toBe(false)
    expect(codeOf(() => decryptField(dek(), ctx, 7 as unknown as string))).toBe('format')
  })

  it('a wrapped key is wk1.<master id>.<base64url>', () => {
    const r = ring()
    const w = wrapDek(r.current, TENANT, 'dk-1', key32())
    expect(w.startsWith('wk1.mk-a.')).toBe(true)
    expect(wrappedMasterId(w)).toBe('mk-a')
    expect(codeOf(() => wrappedMasterId(w.replace('wk1', 'sf1')))).toBe('format')
  })
})

describe('input checks', () => {
  it('encryptField refuses a non-string, a bad DEK id, and a malformed context', () => {
    expect(codeOf(() => encryptField(dek(), ctx, 1 as unknown as string))).toBe('input')
    expect(codeOf(() => encryptField(dek('bad.id'), ctx, 'x'))).toBe('input')
    expect(codeOf(() => encryptField(dek(), { ...ctx, tenantId: '' }, 'x'))).toBe('input')
    expect(codeOf(() => encryptField(dek(), { ...ctx, rowId: 'r'.repeat(201) }, 'x'))).toBe('input')
    expect(() => encryptField(dek(), { ...ctx, rowId: 'r'.repeat(200) }, 'x')).not.toThrow()
    expect(codeOf(() => encryptField(dek(), { ...ctx, table: 'Participants' }, 'x'))).toBe('input')
    expect(codeOf(() => encryptField(dek(), { ...ctx, table: '1abc' }, 'x'))).toBe('input')
    expect(codeOf(() => encryptField(dek(), { ...ctx, column: `a${'b'.repeat(63)}` }, 'x'))).toBe('input')
    expect(() => encryptField(dek(), { ...ctx, column: `a${'b'.repeat(62)}` }, 'x')).not.toThrow()
    expect(codeOf(() => encryptField(dek(), { ...ctx, column: 'x-y' }, 'x'))).toBe('input')
    expect(codeOf(() => encryptField(dek(), { ...ctx, tenantId: 5 as unknown as string }, 'x'))).toBe('input')
  })

  it('wrapDek refuses a bad tenant, a bad DEK id or a DEK of the wrong size', () => {
    const r = ring()
    expect(codeOf(() => wrapDek(r.current, '', 'dk-1', key32()))).toBe('input')
    expect(codeOf(() => wrapDek(r.current, TENANT, 'dk.1', key32()))).toBe('input')
    expect(codeOf(() => wrapDek(r.current, TENANT, 'dk-1', randomBytes(31)))).toBe('input')
    expect(codeOf(() => unwrapDek(r, '', 'dk-1', wrapDek(r.current, TENANT, 'dk-1', key32())))).toBe('input')
    expect(codeOf(() => unwrapDek(r, TENANT, 'dk.1', wrapDek(r.current, TENANT, 'dk-1', key32())))).toBe('input')
  })

  it('unwrap: an unknown master id is no_key; a sealed value that is not 32 bytes is auth', () => {
    const r = ring()
    const w = wrapDek(r.current, TENANT, 'dk-1', key32())
    expect(codeOf(() => unwrapDek({ current: { id: 'mk-z', key: key32() } }, TENANT, 'dk-1', w))).toBe('no_key')
    expect(codeOf(() => unwrapDek(r, TENANT, 'dk-2', w))).toBe('auth')
    // A correctly sealed 16-byte "DEK": authentic, but not a DEK.
    const aad = Buffer.from(JSON.stringify(['wk1', TENANT, 'dk-1', 'mk-a']), 'utf8')
    const short = `wk1.mk-a.${sealGcm(r.current.key, randomBytes(16), aad).toString('base64url')}`
    expect(codeOf(() => unwrapDek(r, TENANT, 'dk-1', short))).toBe('auth')
    // The previous key opens what it wrapped; rewrap moves it to the current one.
    const prev = { id: 'mk-old', key: key32() }
    const dk = key32()
    const old = wrapDek(prev, TENANT, 'dk-1', dk)
    const both = { current: r.current, previous: prev }
    expect(unwrapDek(both, TENANT, 'dk-1', old).equals(dk)).toBe(true)
    expect(wrappedMasterId(rewrapDek(both, TENANT, 'dk-1', old))).toBe('mk-a')
  })

  it('decryptField: a lookup that misses is no_key; a wrong context is auth', () => {
    const d = dek('dk-1')
    const c = encryptField(d, ctx, 'secret')
    expect(decryptField((id) => (id === 'dk-1' ? d : undefined), ctx, c)).toBe('secret')
    expect(codeOf(() => decryptField(() => undefined, ctx, c))).toBe('no_key')
    expect(codeOf(() => decryptField(dek('dk-2'), ctx, c))).toBe('no_key')
    expect(codeOf(() => decryptField(d, { ...ctx, rowId: 'other' }, c))).toBe('auth')
    expect(codeOf(() => decryptField(d, { ...ctx, table: 'BAD' }, c))).toBe('input')
  })
})

describe('blind indexes', () => {
  it('newDekId is d<yyyymmdd>-<8 base64url characters>', () => {
    const id = newDekId(new Date('2026-03-04T23:59:59Z'))
    expect(id).toMatch(/^d20260304-[A-Za-z0-9_-]{8}$/)
    expect(KEY_ID_PATTERN.test(id)).toBe(true)
    expect(newDekId()).toMatch(/^d\d{8}-/)
  })

  it('normalises email, phone and text exactly', () => {
    expect(normaliseForIndex('  Kid@School.TEST ', 'email')).toBe('kid@school.test')
    expect(normaliseForIndex(' +61 (4) 1234-5678 ', 'phone')).toBe('+61412345678')
    expect(normaliseForIndex('61 412 345 678', 'phone')).toBe('61412345678')
    expect(normaliseForIndex('  Peanut   AND\ttree  nuts ', 'text')).toBe('peanut and tree nuts')
    expect(normaliseForIndex('ＡＢ', 'text')).toBe('ab')
  })

  it('a blind index is bi1.<dek id>.<43-char base64url HMAC>', () => {
    const d = dek('dk-3')
    const col = { tenantId: TENANT, table: 'members', column: 'ec_email' }
    const bi = blindIndex(d, col, 'a@b.co', 'email')!
    expect(bi).toMatch(/^bi1\.dk-3\.[A-Za-z0-9_-]{43}$/)
    expect(blindIndex(d, col, 'A@B.CO ', 'email')).toBe(bi)
    expect(blindIndex(d, col, '  ', 'email')).toBeNull()
    expect(codeOf(() => blindIndex(d, col, 3 as unknown as string, 'email'))).toBe('input')
    expect(codeOf(() => blindIndex(dek('x.y'), col, 'a', 'email'))).toBe('input')
    // The key id is bound into the derived key: same key bytes, another id, another index.
    expect(blindIndex({ keyId: 'dk-4', key: d.key }, col, 'a@b.co', 'email')!.split('.')[2]).not.toBe(bi.split('.')[2])
  })

  it('blindIndexEquals: equal, unequal, different lengths, non-strings', () => {
    expect(blindIndexEquals('abc', 'abc')).toBe(true)
    expect(blindIndexEquals('abc', 'abd')).toBe(false)
    expect(blindIndexEquals('abc', 'abcd')).toBe(false)
    expect(blindIndexEquals('abcd', 'abc')).toBe(false)
    expect(blindIndexEquals('', '')).toBe(true)
    expect(blindIndexEquals(null, 'a')).toBe(false)
    expect(blindIndexEquals('a', undefined)).toBe(false)
  })
})

describe('FieldCrypto service', () => {
  function store(rows: DekRow[] = []): DekStore & { rows: DekRow[]; lists: number } {
    const s = {
      rows,
      lists: 0,
      async listKeys(t: string) {
        s.lists++
        return s.rows.filter((r) => r.tenant_id === t)
      },
      async insertKey(r: Omit<DekRow, 'created_at' | 'retired_at'>) {
        if (s.rows.some((x) => x.tenant_id === r.tenant_id && !x.retired_at)) return 'conflict' as const
        s.rows.push({ ...r, created_at: new Date().toISOString(), retired_at: null })
        return 'ok' as const
      },
    }
    return s
  }

  it('ignores rows for another tenant that the store returns', async () => {
    const r = ring()
    const other = '00000000-0000-4000-8000-0000000000b2'
    const s = store()
    s.listKeys = async () => [
      { tenant_id: other, key_id: 'dk-x', master_key_id: 'mk-a', wrapped_dek: wrapDek(r.current, other, 'dk-x', key32()), created_at: '', retired_at: null },
    ]
    const fc = new FieldCrypto(r, s)
    expect(await fc.allKeys(TENANT)).toEqual([])
  })

  it('the active key is the last unretired row; retired keys still decrypt', async () => {
    const r = ring()
    const k1 = key32()
    const k2 = key32()
    const s = store([
      { tenant_id: TENANT, key_id: 'dk-1', master_key_id: 'mk-a', wrapped_dek: wrapDek(r.current, TENANT, 'dk-1', k1), created_at: '1', retired_at: '2' },
      { tenant_id: TENANT, key_id: 'dk-2', master_key_id: 'mk-a', wrapped_dek: wrapDek(r.current, TENANT, 'dk-2', k2), created_at: '2', retired_at: null },
    ])
    const fc = new FieldCrypto(r, s)
    expect((await fc.activeKey(TENANT)).keyId).toBe('dk-2')
    expect((await fc.keyById(TENANT, 'dk-1'))?.key.equals(k1)).toBe(true)
    const old = encryptField({ keyId: 'dk-1', key: k1 }, ctx, 'old value')
    expect(await fc.decrypt(ctx, old)).toBe('old value')
    expect(fieldKeyId(await fc.encrypt(ctx, 'new'))).toBe('dk-2')
  })

  it('decrypt of an unknown key id reloads once, then is no_key', async () => {
    const fc = new FieldCrypto(ring(), store())
    const c = encryptField(dek('dk-missing'), ctx, 'x')
    await expect(fc.decrypt(ctx, c)).rejects.toMatchObject({ code: 'no_key' })
  })

  it('an insert that throws is a store error; no active row after insert is no_key', async () => {
    const s = store()
    s.insertKey = async () => {
      throw new Error('db')
    }
    await expect(new FieldCrypto(ring(), s).activeKey(TENANT)).rejects.toMatchObject({ code: 'store' })
    const s2 = store()
    s2.insertKey = async () => 'ok'
    await expect(new FieldCrypto(ring(), s2).activeKey(TENANT)).rejects.toMatchObject({ code: 'no_key' })
  })

  it('creates a DEK wrapped under the current master, with a dated id', async () => {
    const r = ring()
    const s = store()
    const fc = new FieldCrypto(r, s, { now: () => Date.parse('2026-11-22T10:00:00Z') })
    const k = await fc.activeKey(TENANT)
    expect(k.keyId).toMatch(/^d20261122-/)
    expect(s.rows[0]).toMatchObject({ tenant_id: TENANT, key_id: k.keyId, master_key_id: 'mk-a' })
    expect(unwrapDek(r, TENANT, k.keyId, s.rows[0].wrapped_dek).equals(k.key)).toBe(true)
  })

  it('the cache is fresh strictly inside the TTL; the active key is rechecked at activeCheckMs', async () => {
    let t = 1_000_000
    const s = store()
    const fc = new FieldCrypto(ring(), s, { now: () => t, cacheTtlMs: 1000, activeCheckMs: 100 })
    await fc.activeKey(TENANT)
    const lists = s.lists
    await fc.allKeys(TENANT)
    expect(s.lists).toBe(lists)
    t += 999
    await fc.allKeys(TENANT)
    expect(s.lists).toBe(lists)
    t += 1
    await fc.allKeys(TENANT)
    expect(s.lists).toBe(lists + 1)
    // activeKey: under 100 ms old, no reload; at 100 ms, a reload.
    t += 99
    await fc.activeKey(TENANT)
    expect(s.lists).toBe(lists + 1)
    t += 1
    await fc.activeKey(TENANT)
    expect(s.lists).toBe(lists + 2)
  })

  it('defaults: a 5-minute cache and a 30-second active check', async () => {
    let t = 0
    const s = store()
    const fc = new FieldCrypto(ring(), s, { now: () => t })
    await fc.activeKey(TENANT)
    const lists = s.lists
    t = 29_999
    await fc.activeKey(TENANT)
    expect(s.lists).toBe(lists)
    t = 30_000
    await fc.activeKey(TENANT)
    expect(s.lists).toBe(lists + 1)
    t = 30_000 + 5 * 60 * 1000 - 1
    await fc.allKeys(TENANT)
    expect(s.lists).toBe(lists + 1)
    t += 1
    await fc.allKeys(TENANT)
    expect(s.lists).toBe(lists + 2)
  })

  it('clearCache forces a reload; a bad tenant id is input', async () => {
    const s = store()
    const fc = new FieldCrypto(ring(), s)
    await fc.allKeys(TENANT)
    fc.clearCache()
    await fc.allKeys(TENANT)
    expect(s.lists).toBe(2)
    await expect(fc.allKeys('')).rejects.toMatchObject({ code: 'input' })
  })

  it('blindIndexCandidates gives one index per DEK, and none for an empty value', async () => {
    const r = ring()
    const s = store([
      { tenant_id: TENANT, key_id: 'dk-1', master_key_id: 'mk-a', wrapped_dek: wrapDek(r.current, TENANT, 'dk-1', key32()), created_at: '1', retired_at: '2' },
      { tenant_id: TENANT, key_id: 'dk-2', master_key_id: 'mk-a', wrapped_dek: wrapDek(r.current, TENANT, 'dk-2', key32()), created_at: '2', retired_at: null },
    ])
    const fc = new FieldCrypto(r, s)
    const col = { tenantId: TENANT, table: 'members', column: 'ec_email' }
    const c = await fc.blindIndexCandidates(col, 'a@b.co', 'email')
    expect(c.map((x) => x.split('.')[1])).toEqual(['dk-1', 'dk-2'])
    expect(c).toContain(await fc.blindIndex(col, 'a@b.co', 'email'))
    expect(await fc.blindIndexCandidates(col, ' ', 'email')).toEqual([])
  })
})
