// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Drive client, faked: the file is found and trashing it succeeds. A
// permanent delete would be refused the way a shared drive refuses a Content
// manager (404 "File not found"), so remove() must never call it.
const files = {
  list: vi.fn(async () => ({ data: { files: [{ id: 'f1' }] } })),
  update: vi.fn(async (): Promise<unknown> => ({ data: { id: 'f1' } })),
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
  files.update.mockClear()
  files.delete.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('driveBackupStore.remove', () => {
  it('moves the file to trash and never deletes permanently', async () => {
    expect(await driveBackupStore('folder').remove('export-2026-10-07.json.enc')).toBe(true)
    expect(files.update).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'f1', supportsAllDrives: true, requestBody: { trashed: true } }),
    )
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('reports false when there is nothing to remove', async () => {
    files.list.mockImplementationOnce(async () => ({ data: { files: [] } }))
    expect(await driveBackupStore('folder').remove('x')).toBe(false)
    expect(files.update).not.toHaveBeenCalled()
  })

  it('names the missing role when Drive refuses to trash', async () => {
    files.update.mockImplementationOnce(async () => { throw Object.assign(new Error('Insufficient permissions'), { code: 403 }) })
    await expect(driveBackupStore('folder').remove('x')).rejects.toThrow(/Content manager role on the backup folder/)
  })

  it('passes other errors through unchanged', async () => {
    files.update.mockImplementationOnce(async () => { throw Object.assign(new Error('Backend error'), { code: 500 }) })
    await expect(driveBackupStore('folder').remove('x')).rejects.toThrow('Backend error')
  })
})
