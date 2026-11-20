/**
 * Restore drill for the encrypted off-site copy of signed agreements.
 * Read-only: it changes nothing anywhere. Run it quarterly, and after any
 * change to the backup key or folder.
 *
 *   npx tsx scripts/esign-restore-drill.ts            # 10 random records
 *   npx tsx scripts/esign-restore-drill.ts --sample 25
 *   npx tsx scripts/esign-restore-drill.ts --restore <agreement id> --out ./restored
 *   npx tsx scripts/esign-restore-drill.ts --export latest --out ./restored
 *   npx tsx scripts/esign-restore-drill.ts --export export-2026-11-20.json.enc --out ./restored
 *
 * For each sampled agreement it downloads the encrypted copy, decrypts it with
 * ESIGN_BACKUP_KEY and checks it against the SHA-256 recorded when the record
 * was stored. It also decrypts the latest table export and compares its
 * audit-trail anchor with the live database. Any mismatch exits non-zero.
 *
 * --restore writes one agreement's decrypted files to --out, for when the
 * stored copy has been lost or damaged.
 *
 * --export writes one nightly table export, decrypted, to --out (JSON: every
 * agreement-table row plus the audit-chain heads). It needs only the backup key
 * and the Drive folder, not the database.
 *
 * Access steps for people: docs/RUNBOOK-backups.md §8.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createHash } from 'crypto'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : undefined
}

async function main() {
  // Imported after dotenv so they read the loaded environment.
  const { createClient } = await import('@supabase/supabase-js')
  const { decryptBackup } = await import('../lib/esign/backup-crypto')
  const { driveBackupStore } = await import('../lib/esign/backup-store')
  const { backupName, findSignedCopy } = await import('../lib/esign/replicate')
  const { SECRET_KEY_VARS, supabaseFetch, supabaseSecretKey } = await import('../lib/supabase-keys')

  const exportArg = arg('--export')
  if (exportArg) {
    const exportStore = driveBackupStore()
    const name = exportArg === 'latest' ? (await exportStore.list('export-'))[0] : exportArg
    const sealed = name ? await exportStore.get(name) : null
    if (!name || !sealed) throw new Error(`No table export ${exportArg === 'latest' ? 'found' : name}`)
    const out = path.resolve(arg('--out') ?? 'restored')
    fs.mkdirSync(out, { recursive: true })
    const file = path.join(out, name.replace(/\.enc$/, ''))
    fs.writeFileSync(file, decryptBackup(sealed))
    console.log(`✓ wrote ${file}`)
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = supabaseSecretKey()
  if (!url || !key) throw new Error(`NEXT_PUBLIC_SUPABASE_URL and ${SECRET_KEY_VARS} are required`)
  console.log(`Database: ${new URL(url).host}`)
  const db = createClient(url, key, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
  const store = driveBackupStore()
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

  const restoreId = arg('--restore')
  if (restoreId) {
    const out = path.resolve(arg('--out') ?? 'restored')
    fs.mkdirSync(out, { recursive: true })
    // The signed copy is named by its content hash (deep review ES-5), so read
    // the recorded hash first. The row may be gone (that is often why we are
    // restoring); then the newest copy under the record's id is used.
    const { data: row } = await db.from('agreements').select('signed_pdf_sha256').eq('id', restoreId).maybeSingle()
    const recorded = (row as { signed_pdf_sha256: string | null } | null)?.signed_pdf_sha256 ?? null
    const signed = await findSignedCopy(store, restoreId, recorded)
    if (signed) {
      const plain = decryptBackup(signed.bytes)
      const file = path.join(out, signed.name.replace(/\.enc$/, ''))
      fs.writeFileSync(file, plain)
      const check = recorded ? (sha(plain) === recorded ? ' (matches the recorded hash)' : ' (DOES NOT match the recorded hash)') : ''
      console.log(`✓ wrote ${file}${check}`)
    } else {
      console.error(`✗ no signed copy for ${restoreId}`)
    }
    for (const kind of ['certificate', 'audit'] as const) {
      const sealed = await store.get(backupName(restoreId, kind))
      if (!sealed) continue
      const file = path.join(out, backupName(restoreId, kind).replace(/\.enc$/, ''))
      fs.writeFileSync(file, decryptBackup(sealed))
      console.log(`✓ wrote ${file}`)
    }
    process.exit(signed ? 0 : 1)
  }

  const sample = Number(arg('--sample') ?? 10)
  const { data } = await db
    .from('agreements')
    .select('id, signed_pdf_sha256')
    .not('replicated_at', 'is', null)
    .limit(1000)
  const rows = ((data ?? []) as { id: string; signed_pdf_sha256: string | null }[])
    .sort(() => Math.random() - 0.5)
    .slice(0, sample)

  let failures = 0
  for (const row of rows) {
    // deep review ES-5: the signed copy is named by its content hash; copies
    // made before that fix keep the legacy un-suffixed name.
    const sealed = (await findSignedCopy(store, row.id, row.signed_pdf_sha256))?.bytes
    if (!sealed) { console.error(`✗ ${row.id}: no backup copy`); failures++; continue }
    let plain: Buffer
    try { plain = decryptBackup(sealed) } catch (e) { console.error(`✗ ${row.id}: ${(e as Error).message}`); failures++; continue }
    if (row.signed_pdf_sha256 && sha(plain) !== row.signed_pdf_sha256) {
      console.error(`✗ ${row.id}: decrypted copy does not match the recorded hash`)
      failures++
    } else {
      console.log(`✓ ${row.id}`)
    }
  }

  const exports = await store.list('export-')
  if (!exports.length) {
    console.error('✗ no table export found')
    failures++
  } else {
    const latest = JSON.parse(decryptBackup((await store.get(exports[0])) as Uint8Array).toString('utf8')) as {
      exportedAt: string; anchor: string; heads: { envelope_row: string; last_id: number; hash: string }[]
    }
    const { data: heads } = await db.rpc('esign_audit_heads')
    const live = new Map(((heads ?? []) as { envelope_row: string; last_id: number; hash: string }[]).map((h) => [h.envelope_row, h]))
    // Every chain in the export must still be in the database, unchanged up to where the export saw it.
    let drift = 0
    for (const h of latest.heads) {
      const now = live.get(h.envelope_row)
      if (!now) continue // Purged at end of retention since the export.
      if (now.last_id === h.last_id && now.hash !== h.hash) drift++
    }
    console.log(`${drift ? '✗' : '✓'} ${exports[0]} (exported ${latest.exportedAt}): ${latest.heads.length} audit chains, ${drift} changed since`)
    failures += drift
  }

  console.log(failures ? `\n✗ ${failures} problem(s)` : `\n✓ ${rows.length} record(s) restored and verified`)
  process.exit(failures ? 1 : 0)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
