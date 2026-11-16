import type { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/app-errors'
import { appendAudit } from '@/lib/esign/native/audit'
import { sealConfigured, sealPdf, type tsaClient } from '@/lib/esign/native/seal'
import type { TimestampFailure } from '@/lib/esign/native/tsa-verify'
import { putImmutable, sha256Hex, SIGNED_BUCKET } from '@/lib/esign/storage'

// Puts the certificate seal (./seal) on a stored Stellr signing agreement.
//
// Run at completion for new agreements and daily for any still carrying only
// the day-one hash seal, so agreements signed before the certificate existed
// are sealed retroactively. The hash-sealed original stays in storage beside
// the sealed copy, as the file the signers were first given; its path is in
// the 'sealed' audit event, which is how the retention purge finds it.

const REASON = 'Signed by every party through Stellr signing; sealed by Stellr Education'

// The checks a timestamp token can fail (tsa-verify's TimestampFailure). Only
// one of these names reaches the audit trail: never the service's message, the
// token or any certificate bytes.
const TIMESTAMP_FAILURES: readonly TimestampFailure[] = ['malformed', 'refused', 'imprint', 'nonce', 'signature', 'eku', 'chain', 'time']

/**
 * The failed check's name when the seal dropped to plain `pades` because the
 * timestamp service's token did not verify; null otherwise (a timestamp was
 * had, none was asked for, or the service could not be reached).
 */
export function timestampFailureCode(timestampError: string | null): TimestampFailure | null {
  const m = /^verification failed \(([a-z]+)\)/.exec(timestampError ?? '')
  const code = m?.[1] as TimestampFailure | undefined
  return code && TIMESTAMP_FAILURES.includes(code) ? code : null
}

export type CertificateSealOutcome =
  | { sealed: true; kind: 'pades' | 'pades-t'; path: string }
  | { sealed: false; reason: string }

export async function applyCertificateSeal(
  db: SupabaseClient,
  rowId: string,
  now = new Date(),
  // Tests hand in a timestamp client; otherwise sealPdf builds its own.
  opts: { tsa?: ReturnType<typeof tsaClient> | null } = {},
): Promise<CertificateSealOutcome> {
  if (!sealConfigured()) return { sealed: false, reason: 'no seal certificate configured' }
  const { data: row, error } = await db
    .from('agreements')
    .select('id, provider, status, seal_kind, signed_pdf_path, signed_pdf_sha256')
    .eq('id', rowId)
    .maybeSingle()
  if (error) throw new Error(`Agreement lookup failed: ${error.message}`)
  if (!row || row.provider !== 'native' || row.status !== 'completed' || row.seal_kind !== 'hash' || !row.signed_pdf_path) {
    return { sealed: false, reason: 'not a hash-sealed Stellr signing agreement' }
  }

  const { data: blob, error: dlError } = await db.storage.from(SIGNED_BUCKET).download(row.signed_pdf_path as string)
  if (dlError || !blob) throw new Error(`Stored agreement could not be read: ${dlError?.message ?? 'missing'}`)
  const original = new Uint8Array(await blob.arrayBuffer())
  // Never seal a file that is not the one recorded: that would vouch for a change.
  if (row.signed_pdf_sha256 && sha256Hex(original) !== row.signed_pdf_sha256) {
    throw new Error('Stored agreement does not match its recorded hash; not sealing it')
  }

  const result = await sealPdf(original, { reason: REASON, at: now, ...('tsa' in opts ? { tsa: opts.tsa } : {}) })
  const path = (row.signed_pdf_path as string).replace(/signed\.pdf$/, 'sealed.pdf')
  if (path === row.signed_pdf_path) throw new Error(`Unexpected stored path ${row.signed_pdf_path}`)
  const sha = await putImmutable(db, path, result.bytes, 'application/pdf')

  // Only if still hash-sealed: two runs at once seal it once.
  const { data: updated, error: upError } = await db
    .from('agreements')
    .update({
      signed_pdf_path: path,
      signed_pdf_sha256: sha,
      signed_pdf_bytes: result.bytes.byteLength,
      seal_kind: result.kind,
      replicated_at: null, // the off-site copy is refreshed with the sealed file
      updated_at: now.toISOString(),
    })
    .eq('id', rowId)
    .eq('seal_kind', 'hash')
    .select('id')
  if (upError) throw new Error(`Recording the seal failed: ${upError.message}`)
  if (!updated?.length) return { sealed: false, reason: 'sealed by another run' }

  // A token that failed verification leaves a seal with no trusted time. That
  // is allowed (signing is never blocked), but it must not be silent: the
  // check's name goes in the audit event and staff see it in app_errors.
  const timestampError = result.kind === 'pades' ? timestampFailureCode(result.timestampError) : null
  if (timestampError) {
    await reportError(new Error(`Certificate seal: timestamp verification failed (${timestampError}); sealed without a trusted timestamp`), {
      route: 'esign certificate seal',
      db,
    })
  }

  await appendAudit(db, {
    envelopeRow: rowId,
    event: 'sealed',
    detail: {
      sealKind: result.kind,
      sha256: sha,
      previousPath: row.signed_pdf_path,
      previousSha256: row.signed_pdf_sha256,
      certificate: result.certificate,
      timestampedAt: result.timestampedAt,
      ...(timestampError ? { timestamp_error: timestampError } : {}),
    },
  })
  return { sealed: true, kind: result.kind, path }
}

export interface SealPendingResult {
  eligible: number
  sealed: number
  failed: { id: string; error: string }[]
  skipped?: string
}

/** The daily pass: certificate-seals Stellr signing agreements that have only the hash seal. */
export async function sealPending(db: SupabaseClient, opts: { limit: number; dryRun?: boolean; now?: Date }): Promise<SealPendingResult> {
  if (!sealConfigured()) return { eligible: 0, sealed: 0, failed: [], skipped: 'no seal certificate configured' }
  const { data, error } = await db
    .from('agreements')
    .select('id')
    .eq('provider', 'native')
    .eq('status', 'completed')
    .eq('seal_kind', 'hash')
    .order('completed_at', { ascending: true })
    .limit(opts.limit)
  if (error) throw new Error(`Seal work list query failed: ${error.message}`)
  const ids = (data ?? []).map((r) => r.id as string)
  if (opts.dryRun) return { eligible: ids.length, sealed: 0, failed: [] }
  let sealed = 0
  const failed: { id: string; error: string }[] = []
  for (const id of ids) {
    try {
      if ((await applyCertificateSeal(db, id, opts.now)).sealed) sealed++
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { eligible: ids.length, sealed, failed }
}
