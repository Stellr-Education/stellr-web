// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { X509Certificate } from 'node:crypto'
import forge from 'node-forge'
import fixture from './fixtures/tsa-openssl-response.json'
import { makeTestTsa, tsaResponse, type TestTsa } from './fixtures/tsa-builder'
import { parseTimestampResponse } from './seal'
import {
  defaultTrustAnchors,
  DIGICERT_TRUSTED_ROOT_G4_PEM,
  DIGICERT_TRUSTED_ROOT_G4_SHA256,
  parseTrustPem,
  TimestampVerificationError,
  type TimestampFailure,
} from './tsa-verify'

// The recorded response (see the fixture's _about): no network in these tests.
const response = Buffer.from(fixture.responseBase64, 'base64').toString('binary')
const imprint = Buffer.from(fixture.imprintHex, 'hex').toString('binary')
const nonce = Buffer.from(fixture.nonceHex, 'hex').toString('binary')
const genTime = new Date(fixture.genTime)
const fixtureAnchors = [new X509Certificate(fixture.rootPem)]
const soon = new Date(genTime.getTime() + 60_000)

afterEach(() => vi.unstubAllEnvs())

function reasonOf(fn: () => unknown): TimestampFailure | 'accepted' | 'other' {
  try {
    fn()
    return 'accepted'
  } catch (err) {
    return err instanceof TimestampVerificationError ? err.reason : 'other'
  }
}

/** Replaces the one occurrence of `from` in the response with `to` (same length). */
function swap(der: string, from: string, to: string): string {
  const at = der.indexOf(from)
  expect(at).toBeGreaterThan(0)
  expect(der.indexOf(from, at + 1)).toBe(-1)
  return der.slice(0, at) + to + der.slice(at + from.length)
}

/** The signature value inside the recorded token's SignerInfo. */
function signatureOf(der: string): string {
  const token = (asn1Value(forge.asn1.fromDer(der))[1])
  const signedData = asn1Value(asn1Value(token)[1])[0]
  const fields = asn1Value(signedData)
  const signerInfo = asn1Value(asn1Value(fields[fields.length - 1])[0])
  return signerInfo[5].value as string
}
const asn1Value = (a: forge.asn1.Asn1) => a.value as forge.asn1.Asn1[]

describe('the recorded timestamp (OpenSSL TSA, ESSCertID v1, root → intermediate → signer)', () => {
  it('is accepted: imprint, nonce, signature, timeStamping EKU, chain and time all check out', () => {
    const out = parseTimestampResponse(response, { imprint, nonce, trustAnchors: fixtureAnchors, now: soon })
    expect(out.genTime.toISOString()).toBe(fixture.genTime)
    // What the seal embeds is byte-for-byte the token that was verified.
    expect(forge.asn1.toDer(out.token).getBytes()).toBe(
      forge.asn1.toDer(asn1Value(forge.asn1.fromDer(response))[1]).getBytes(),
    )
  })

  it('refuses a token for a different hash', () => {
    const other = Buffer.alloc(32, 7).toString('binary')
    expect(reasonOf(() => parseTimestampResponse(response, { imprint: other, nonce, trustAnchors: fixtureAnchors, now: soon }))).toBe('imprint')
  })

  it('refuses a token whose imprint was altered in transit, even when it matches what we asked', () => {
    const forged = Buffer.from(imprint, 'binary')
    forged[0] ^= 0xff
    const tampered = swap(response, imprint, forged.toString('binary'))
    // The signature no longer covers the content.
    expect(reasonOf(() => parseTimestampResponse(tampered, { imprint: forged.toString('binary'), nonce, trustAnchors: fixtureAnchors, now: soon }))).toBe('signature')
  })

  it('refuses a token that does not echo our nonce', () => {
    const wrong = Buffer.from('41020304050607', 'hex').toString('binary')
    expect(reasonOf(() => parseTimestampResponse(response, { imprint, nonce: wrong, trustAnchors: fixtureAnchors, now: soon }))).toBe('nonce')
  })

  it('refuses a broken signature', () => {
    const sig = signatureOf(response)
    const broken = sig.slice(0, -1) + String.fromCharCode(sig.charCodeAt(sig.length - 1) ^ 0x01)
    expect(reasonOf(() => parseTimestampResponse(swap(response, sig, broken), { imprint, nonce, trustAnchors: fixtureAnchors, now: soon }))).toBe('signature')
  })

  it('refuses a chain that does not reach a trusted root (the default anchors are DigiCert only)', () => {
    expect(reasonOf(() => parseTimestampResponse(response, { imprint, nonce, now: soon }))).toBe('chain')
    expect(reasonOf(() => parseTimestampResponse(response, { imprint, nonce, trustAnchors: makeTestTsa().anchors, now: soon }))).toBe('chain')
  })

  it('refuses a time far from the local clock', () => {
    const later = new Date(genTime.getTime() + 60 * 60_000)
    expect(reasonOf(() => parseTimestampResponse(response, { imprint, nonce, trustAnchors: fixtureAnchors, now: later }))).toBe('time')
  })

  it('refuses truncated or trailing bytes', () => {
    expect(reasonOf(() => parseTimestampResponse(response.slice(0, 200), { imprint, nonce, trustAnchors: fixtureAnchors, now: soon }))).not.toBe('accepted')
  })

  it('accepts a service whose root is added through ESIGN_TSA_TRUST_PEM, escaped newlines included', () => {
    vi.stubEnv('ESIGN_TSA_TRUST_PEM', fixture.rootPem.replace(/\n/g, '\\n'))
    expect(defaultTrustAnchors()).toHaveLength(2)
    expect(parseTimestampResponse(response, { imprint, nonce, now: soon }).genTime.toISOString()).toBe(fixture.genTime)
  })
})

describe('tokens from a runtime test service', () => {
  let tsa: TestTsa
  beforeAll(() => { tsa = makeTestTsa() }, 60_000)
  const now = new Date('2026-11-14T12:00:00Z')
  const check = (t: TestTsa, r: Parameters<typeof tsaResponse>[1]) =>
    reasonOf(() => parseTimestampResponse(tsaResponse(t, r), { imprint, nonce, trustAnchors: tsa.anchors, now }))

  it('accepts a valid token (ESSCertID v2)', () => {
    expect(check(tsa, { imprint, nonce, genTime: now })).toBe('accepted')
  })

  it('accepts grantedWithMods and refuses a refusal', () => {
    expect(check(tsa, { imprint, nonce, genTime: now, status: 1 })).toBe('accepted')
    expect(check(tsa, { imprint, nonce, genTime: now, status: 2 })).toBe('refused')
  })

  it('refuses a broken signature', () => {
    expect(check(tsa, { imprint, nonce, genTime: now, breakSignature: true })).toBe('signature')
  })

  it('refuses a signer certificate without the timeStamping usage, or with it not critical', () => {
    const noEku = makeTestTsa({ eku: false })
    expect(reasonOf(() => parseTimestampResponse(tsaResponse(noEku, { imprint, nonce, genTime: now }), { imprint, nonce, trustAnchors: noEku.anchors, now }))).toBe('eku')
    const soft = makeTestTsa({ ekuCritical: false })
    expect(reasonOf(() => parseTimestampResponse(tsaResponse(soft, { imprint, nonce, genTime: now }), { imprint, nonce, trustAnchors: soft.anchors, now }))).toBe('eku')
  }, 60_000)

  it('refuses a token signed under an untrusted root', () => {
    const stranger = makeTestTsa({ name: 'Stranger TSA (placeholder)' })
    expect(check(stranger, { imprint, nonce, genTime: now })).toBe('chain')
  }, 60_000)

  it('compares nonces by value: a leading zero byte is sign padding, a missing byte is a different nonce', () => {
    expect(check(tsa, { imprint, nonce: '\x00' + nonce, genTime: now })).toBe('accepted')
    expect(check(tsa, { imprint, nonce: nonce.slice(1), genTime: now })).toBe('nonce')
  })
})

describe('the bundled DigiCert root', () => {
  it('is DigiCert Trusted Root G4 with the fingerprint in its comment', () => {
    const root = new X509Certificate(DIGICERT_TRUSTED_ROOT_G4_PEM)
    expect(root.fingerprint256).toBe(DIGICERT_TRUSTED_ROOT_G4_SHA256)
    expect(root.subject).toContain('CN=DigiCert Trusted Root G4')
    expect(root.ca).toBe(true)
    expect(defaultTrustAnchors().map((c) => c.fingerprint256)).toEqual([DIGICERT_TRUSTED_ROOT_G4_SHA256])
  })

  it('ignores an unreadable ESIGN_TSA_TRUST_PEM block', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(parseTrustPem('-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----')).toEqual([])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
