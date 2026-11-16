// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { sha256Hex, SIGNED_BUCKET } from '@/lib/esign/storage'
import { applyCertificateSeal, sealPending, timestampFailureCode } from './certificate-seal'
import { purgeExpired } from '@/lib/esign/retention'
import { resetErrorCaptureState } from '@/lib/app-errors'
import { tsaClient } from './seal'
import { makeTestTsa, readRequest, tsaResponse, type TestTsa } from './fixtures/tsa-builder'

let p12: string
let tsa: TestTsa

beforeAll(() => {
  tsa = makeTestTsa()
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '02'
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z')
  cert.setSubject([{ name: 'commonName', value: 'Stellr test seal' }])
  cert.setIssuer([{ name: 'commonName', value: 'Stellr test seal' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  p12 = forge.util.encode64(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { algorithm: '3des' })).getBytes())
}, 60_000)

beforeEach(() => {
  vi.stubEnv('ESIGN_SEAL_P12', p12)
  vi.stubEnv('ESIGN_SEAL_P12_PASSWORD', 'pw')
  vi.stubEnv('ESIGN_TSA_URL', 'off')
})
afterEach(() => vi.unstubAllEnvs())

async function setup(): Promise<{ db: FakeDb; original: Uint8Array }> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  const original = await doc.save()
  const path = 'native/2026/agr-1/signed.pdf'
  const db = fakeSupabase({
    agreements: [
      { id: 'agr-1', provider: 'native', status: 'completed', seal_kind: 'hash', signed_pdf_path: path, signed_pdf_sha256: sha256Hex(original), completed_at: '2026-10-02T00:00:00Z', replicated_at: '2026-10-02T01:00:00Z', certificate_path: 'native/2026/agr-1/audit.json', retain_until: '2020-01-01T00:00:00Z' },
      { id: 'ds-1', provider: 'docusign', status: 'completed', seal_kind: null, signed_pdf_path: 'docusign/2026/ds-1/signed.pdf', completed_at: '2026-10-01T00:00:00Z' },
    ],
    esign_audit_events: [],
  })
  db.objects.set(`${SIGNED_BUCKET}/${path}`, original)
  db.rpcs.esign_append_audit = (a) => { db.table('esign_audit_events').push({ envelope_row: a.p_envelope, event: a.p_event, detail: a.p_detail }); return { id: 1 } }
  return { db, original }
}

describe('applyCertificateSeal', () => {
  it('seals a hash-sealed agreement, keeps the original, and points the record at the sealed copy', async () => {
    const { db, original } = await setup()
    const out = await applyCertificateSeal(db.client, 'agr-1')
    expect(out).toEqual({ sealed: true, kind: 'pades', path: 'native/2026/agr-1/sealed.pdf' })

    const row = db.table('agreements')[0]
    const sealed = db.objects.get(`${SIGNED_BUCKET}/native/2026/agr-1/sealed.pdf`)!
    expect(row).toMatchObject({ seal_kind: 'pades', signed_pdf_path: 'native/2026/agr-1/sealed.pdf', signed_pdf_sha256: sha256Hex(sealed), replicated_at: null })
    expect(db.objects.get(`${SIGNED_BUCKET}/native/2026/agr-1/signed.pdf`)).toEqual(original)
    expect(db.table('esign_audit_events')[0]).toMatchObject({
      event: 'sealed',
      detail: { sealKind: 'pades', previousPath: 'native/2026/agr-1/signed.pdf', previousSha256: sha256Hex(original) },
    })

    // Once only.
    expect(await applyCertificateSeal(db.client, 'agr-1')).toMatchObject({ sealed: false })
  })

  it('refuses to vouch for a file that does not match its recorded hash', async () => {
    const { db } = await setup()
    db.objects.set(`${SIGNED_BUCKET}/native/2026/agr-1/signed.pdf`, new TextEncoder().encode('%PDF-1.7 changed'))
    await expect(applyCertificateSeal(db.client, 'agr-1')).rejects.toThrow(/does not match/)
    expect(db.table('agreements')[0].seal_kind).toBe('hash')
  })

  it('does nothing without a certificate, or for DocuSign records', async () => {
    const { db } = await setup()
    expect(await applyCertificateSeal(db.client, 'ds-1')).toMatchObject({ sealed: false })
    vi.stubEnv('ESIGN_SEAL_P12', '')
    expect(await sealPending(db.client, { limit: 5 })).toMatchObject({ sealed: 0, skipped: expect.any(String) })
  })
})

describe('sealPending and the purge', () => {
  it('seals earlier agreements retroactively, and the 7-year purge removes both copies', async () => {
    const { db } = await setup()
    expect(await sealPending(db.client, { limit: 5 })).toEqual({ eligible: 1, sealed: 1, failed: [] })

    db.rpcs.esign_purge_audit = () => 1
    const purge = await purgeExpired(db.client, { limit: 5, now: new Date('2026-10-03T00:00:00Z') })
    expect(purge.purged).toBe(1)
    expect([...db.objects.keys()].filter((k) => k.includes('agr-1'))).toEqual([])
  })
})

// A timestamp service answering with a token from `signer`.
function tsaService(signer: TestTsa) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = Buffer.from(init?.body as Buffer)
    return new Response(Buffer.from(tsaResponse(signer, { ...readRequest(body), genTime: new Date() }), 'binary'), { status: 200 })
  })
}

describe('the timestamp outcome in the sealed audit event (#726 follow-up)', () => {
  beforeEach(() => resetErrorCaptureState())

  function recordAppErrors(db: FakeDb) {
    const rows: { p_route: string; p_message: string; p_count: number }[] = []
    db.rpcs.record_app_error = (a) => { rows.push(a as never); return null }
    return rows
  }

  it('a verified timestamp seals pades-t with no timestamp_error and no app error', async () => {
    const { db } = await setup()
    const appErrors = recordAppErrors(db)
    const client = tsaClient('https://tsa.test', tsaService(tsa) as never, { trustAnchors: tsa.anchors })
    expect(await applyCertificateSeal(db.client, 'agr-1', new Date(), { tsa: client })).toMatchObject({ sealed: true, kind: 'pades-t' })

    const detail = db.table('esign_audit_events')[0].detail as Record<string, unknown>
    expect(detail).toMatchObject({ sealKind: 'pades-t', previousPath: 'native/2026/agr-1/signed.pdf' })
    expect(detail.timestampedAt).toEqual(expect.any(String))
    expect(detail).not.toHaveProperty('timestamp_error')
    expect(appErrors).toEqual([])
  }, 60_000)

  it('a token that fails verification seals pades, records the failed check, and logs one app error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, original } = await setup()
    const appErrors = recordAppErrors(db)
    const stranger = makeTestTsa({ name: 'Stranger (placeholder)' })
    const client = tsaClient('https://tsa.test', tsaService(stranger) as never, { trustAnchors: tsa.anchors })
    expect(await applyCertificateSeal(db.client, 'agr-1', new Date(), { tsa: client })).toMatchObject({ sealed: true, kind: 'pades' })

    const detail = db.table('esign_audit_events')[0].detail as Record<string, unknown>
    // The existing keys stay (retention finds the original by previousPath).
    expect(detail).toMatchObject({
      sealKind: 'pades',
      previousPath: 'native/2026/agr-1/signed.pdf',
      previousSha256: sha256Hex(original),
      timestampedAt: null,
      timestamp_error: 'chain',
    })
    expect(appErrors).toHaveLength(1)
    expect(appErrors[0]).toMatchObject({ p_route: 'esign certificate seal', p_count: 1 })
    expect(appErrors[0].p_message).toMatch(/timestamp verification failed \(chain\)/)
    // Nothing about the agreement or the certificates in the app error.
    expect(appErrors[0].p_message).not.toMatch(/agr-1|Stranger|BEGIN/)
    err.mockRestore()
  }, 60_000)

  it('an unreachable service or no timestamp asked for adds no timestamp_error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = await setup()
    const appErrors = recordAppErrors(db)
    const down = tsaClient('https://tsa.test', (async () => new Response('', { status: 503 })) as never)
    expect(await applyCertificateSeal(db.client, 'agr-1', new Date(), { tsa: down })).toMatchObject({ sealed: true, kind: 'pades' })
    expect(db.table('esign_audit_events')[0].detail).not.toHaveProperty('timestamp_error')
    expect(appErrors).toEqual([])
    err.mockRestore()
  }, 60_000)

  it('timestampFailureCode passes only a known check name', () => {
    expect(timestampFailureCode('verification failed (signature): Timestamp signature does not verify')).toBe('signature')
    expect(timestampFailureCode('verification failed (bogus): x')).toBeNull()
    expect(timestampFailureCode('unavailable: HTTP 503')).toBeNull()
    expect(timestampFailureCode(null)).toBeNull()
  })
})
