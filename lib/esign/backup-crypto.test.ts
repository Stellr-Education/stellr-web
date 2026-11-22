// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
type Mod = typeof import('./backup-crypto')
let BackupKeyError: Mod['BackupKeyError']
let GCM_IV_BYTES: Mod['GCM_IV_BYTES']
let GCM_KEY_BYTES: Mod['GCM_KEY_BYTES']
let GCM_TAG_BYTES: Mod['GCM_TAG_BYTES']
let GcmOpenError: Mod['GcmOpenError']
let backupConfigured: Mod['backupConfigured']
let backupKey: Mod['backupKey']
let decryptBackup: Mod['decryptBackup']
let encryptBackup: Mod['encryptBackup']
let openGcm: Mod['openGcm']
let sealGcm: Mod['sealGcm']

// The module is loaded afresh before each test: its module-level constants
// and tables are evaluated at load, and a mutation run (stryker.config.mjs)
// switches a mutant on only after a file's static imports have run.
beforeEach(async () => {
  vi.resetModules()
  ;({ BackupKeyError, GCM_IV_BYTES, GCM_KEY_BYTES, GCM_TAG_BYTES, GcmOpenError, backupConfigured, backupKey, decryptBackup, encryptBackup, openGcm, sealGcm } = await import('./backup-crypto'))
})

const key = () => randomBytes(32)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('backupKey', () => {
  it('refuses a missing key, naming the variable', () => {
    expect(() => backupKey('')).toThrow(BackupKeyError)
    expect(() => backupKey('')).toThrow('ESIGN_BACKUP_KEY is not set; signed records cannot be backed up')
  })

  it('refuses a key that is not exactly 32 bytes', () => {
    expect(() => backupKey(randomBytes(31).toString('base64'))).toThrow('ESIGN_BACKUP_KEY must be 32 bytes, base64-encoded')
    expect(() => backupKey(randomBytes(33).toString('base64'))).toThrow(BackupKeyError)
  })

  it('decodes a 32-byte base64 key, and reads ESIGN_BACKUP_KEY by default', () => {
    const k = key()
    expect(backupKey(k.toString('base64')).equals(k)).toBe(true)
    vi.stubEnv('ESIGN_BACKUP_KEY', k.toString('base64'))
    expect(backupKey().equals(k)).toBe(true)
  })
})

describe('backupConfigured', () => {
  it('needs both a valid key and a Drive folder', () => {
    vi.stubEnv('ESIGN_BACKUP_KEY', key().toString('base64'))
    vi.stubEnv('ESIGN_BACKUP_DRIVE_FOLDER_ID', 'folder-1')
    expect(backupConfigured()).toBe(true)
    vi.stubEnv('ESIGN_BACKUP_DRIVE_FOLDER_ID', '')
    expect(backupConfigured()).toBe(false)
    vi.stubEnv('ESIGN_BACKUP_DRIVE_FOLDER_ID', 'folder-1')
    vi.stubEnv('ESIGN_BACKUP_KEY', 'short')
    expect(backupConfigured()).toBe(false)
  })
})

describe('backup format v1', () => {
  it('is SEB1 | 12-byte IV | 16-byte tag | ciphertext, a fresh IV each time', () => {
    const k = key()
    const plain = Buffer.from('signed record bytes')
    const a = encryptBackup(plain, k)
    const b = encryptBackup(plain, k)
    expect(a.subarray(0, 4).toString('latin1')).toBe('SEB1')
    expect(a.length).toBe(4 + 12 + 16 + plain.length)
    expect(a.subarray(4, 16).equals(b.subarray(4, 16))).toBe(false)
    expect(decryptBackup(a, k).equals(plain)).toBe(true)
  })

  it('round-trips an empty payload (header only)', () => {
    const k = key()
    const sealed = encryptBackup(new Uint8Array(0), k)
    expect(sealed.length).toBe(32)
    expect(decryptBackup(sealed, k).length).toBe(0)
  })

  it('refuses a file without the magic, or shorter than the header', () => {
    const k = key()
    const sealed = encryptBackup(Buffer.from('x'), k)
    const wrongMagic = Buffer.from(sealed)
    wrongMagic[0] = 0x58
    expect(() => decryptBackup(wrongMagic, k)).toThrow('Not a Stellr signed-record backup')
    expect(() => decryptBackup(sealed.subarray(0, 31), k)).toThrow('Not a Stellr signed-record backup')
  })

  it('a flipped tag or IV byte fails to decrypt', () => {
    const k = key()
    const sealed = encryptBackup(Buffer.from('payload'), k)
    for (const at of [4, 15, 16, 31]) {
      const bad = Buffer.from(sealed)
      bad[at] ^= 1
      expect(() => decryptBackup(bad, k), `byte ${at}`).toThrow()
    }
  })

  it('uses ESIGN_BACKUP_KEY when no key is passed', () => {
    vi.stubEnv('ESIGN_BACKUP_KEY', key().toString('base64'))
    expect(decryptBackup(encryptBackup(Buffer.from('env'))).toString()).toBe('env')
  })
})

describe('sealGcm / openGcm', () => {
  it('exports the layout constants', () => {
    expect([GCM_IV_BYTES, GCM_TAG_BYTES, GCM_KEY_BYTES]).toEqual([12, 16, 32])
  })

  it('lays out IV | tag | ciphertext and binds the AAD', () => {
    const k = key()
    const sealed = sealGcm(k, Buffer.from('hello'), Buffer.from('aad'))
    expect(sealed.length).toBe(12 + 16 + 5)
    expect(openGcm(k, sealed, Buffer.from('aad')).toString()).toBe('hello')
    expect(() => openGcm(k, sealed, Buffer.from('aae'))).toThrow(GcmOpenError)
  })

  it('opens an empty plaintext sealed at exactly the minimum length', () => {
    const k = key()
    const sealed = sealGcm(k, new Uint8Array(0), new Uint8Array(0))
    expect(sealed.length).toBe(28)
    expect(openGcm(k, sealed, new Uint8Array(0)).length).toBe(0)
    expect(() => openGcm(k, sealed.subarray(0, 27), new Uint8Array(0))).toThrow(GcmOpenError)
  })

  it('refuses a wrong-size key on open, as on seal', () => {
    const sealed = sealGcm(key(), Buffer.from('x'), Buffer.alloc(0))
    expect(() => openGcm(Buffer.alloc(31), sealed, Buffer.alloc(0))).toThrow(RangeError)
    expect(() => openGcm(Buffer.alloc(31), sealed, Buffer.alloc(0))).toThrow('AES-256-GCM needs a 32-byte key')
    expect(() => sealGcm(Buffer.alloc(33), Buffer.from('x'), Buffer.alloc(0))).toThrow('AES-256-GCM needs a 32-byte key')
  })

  it('GcmOpenError carries a fixed message and name, never the OpenSSL text', () => {
    const k = key()
    const sealed = sealGcm(k, Buffer.from('secret'), Buffer.alloc(0))
    sealed[sealed.length - 1] ^= 1
    const err = (() => {
      try {
        openGcm(k, sealed, Buffer.alloc(0))
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toBeInstanceOf(GcmOpenError)
    expect(err!.name).toBe('GcmOpenError')
    expect(err!.message).toBe('Ciphertext could not be authenticated')
  })

  it('a tampered tag fails', () => {
    const k = key()
    const sealed = sealGcm(k, Buffer.from('secret'), Buffer.alloc(0))
    sealed[12] ^= 1
    expect(() => openGcm(k, sealed, Buffer.alloc(0))).toThrow(GcmOpenError)
  })
})
