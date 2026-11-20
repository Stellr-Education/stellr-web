// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Drive client, faked: the file is found, but a permanent delete is
// refused the way a shared drive refuses a Content manager (404 "File not
// found" for a file the same account can see).
const files = {
  list: vi.fn(async () => ({ data: { files: [{ id: 'f1' }] } })),
  delete: vi.fn(async (): Promise<unknown> => {
    throw Object.assign(new Error('File not found: f1.'), { code: 404 })
  }),
  create: vi.fn(),
  get: vi.fn(),
}
vi.mock('@googleapis/drive', () => ({ drive: () => ({ files }) }))
vi.mock('google-auth-library', () => ({ JWT: class {} }))

import { driveBackupStore } from './backup-store'

beforeEach(() => {
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'backup@example.iam.gserviceaccount.com')
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'key')
})
afterEach(() => vi.unstubAllEnvs())

describe('driveBackupStore.remove', () => {
  it('names the missing Manager role when Drive refuses a permanent delete', async () => {
    const store = driveBackupStore('folder')
    await expect(store.remove('export-2026-10-07.json.enc')).rejects.toThrow(/needs the Manager role/)
  })

  it('passes other errors through unchanged', async () => {
    files.delete.mockImplementationOnce(async () => { throw Object.assign(new Error('Backend error'), { code: 500 }) })
    await expect(driveBackupStore('folder').remove('x')).rejects.toThrow('Backend error')
  })

  it('reports true after a delete that succeeds', async () => {
    files.delete.mockImplementationOnce(async () => ({}))
    expect(await driveBackupStore('folder').remove('x')).toBe(true)
  })
})
