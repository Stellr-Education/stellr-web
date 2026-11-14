import { createHash, verify as cryptoVerify, constants as cryptoConstants, X509Certificate } from 'node:crypto'

// Checks an RFC 3161 timestamp token before the seal embeds it (deep review
// v2.11, closing the ES-8 limitation). Until this check the seal trusted
// whatever the timestamp service sent back over TLS.
//
// A token is accepted only when all of these hold:
//   - it is a CMS SignedData whose content is a TSTInfo;
//   - the TSTInfo's message imprint is the SHA-256 we asked about, and its nonce
//     is the one we sent;
//   - the signer's signature over the signed attributes verifies with the
//     signer certificate's key, the messageDigest attribute is the hash of the
//     TSTInfo, and the signing-certificate attribute names that certificate;
//   - the signer certificate carries the timeStamping extended key usage
//     (critical, as RFC 3161 §2.3 requires), and builds through the
//     certificates in the token to a trust anchor, every link valid at genTime;
//   - genTime is within a few minutes of the local clock.
//
// Parsing is a small DER reader over the exact bytes received, and every
// cryptographic check uses node:crypto, not node-forge (forge's PKCS#1 v1.5
// verify has a history of advisories; see the seal's notes). No new dependency.
//
// Trust anchors: DigiCert's timestamping root, bundled below, for the default
// service (https://timestamp.digicert.com). ESIGN_TSA_TRUST_PEM may add one or
// more PEM certificates for another service. Roots are never fetched at runtime.

/**
 * DigiCert Trusted Root G4, the root of DigiCert's timestamping chain
 * (DigiCert Trusted G4 ... TimeStamping CA → this root).
 *   Source: the macOS system root store (SystemRootCertificates.keychain),
 *           cross-checked against Node's bundled Mozilla root list
 *           (tls.rootCertificates); also published at
 *           https://cacerts.digicert.com/DigiCertTrustedRootG4.crt
 *   Subject: C=US, O=DigiCert Inc, OU=www.digicert.com, CN=DigiCert Trusted Root G4
 *   Serial:  059B1B579E8E2132E23907BDA777755C
 *   Valid:   2013-08-01 to 2038-01-15
 *   SHA-256: 55:2F:7B:DC:F1:A7:AF:9E:6C:E6:72:01:7F:4F:12:AB:F7:72:40:C7:8E:76:1A:C2:03:D1:D9:D2:0A:C8:99:88
 */
export const DIGICERT_TRUSTED_ROOT_G4_PEM = `-----BEGIN CERTIFICATE-----
MIIFkDCCA3igAwIBAgIQBZsbV56OITLiOQe9p3d1XDANBgkqhkiG9w0BAQwFADBi
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSEwHwYDVQQDExhEaWdpQ2VydCBUcnVzdGVkIFJvb3Qg
RzQwHhcNMTMwODAxMTIwMDAwWhcNMzgwMTE1MTIwMDAwWjBiMQswCQYDVQQGEwJV
UzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cuZGlnaWNlcnQu
Y29tMSEwHwYDVQQDExhEaWdpQ2VydCBUcnVzdGVkIFJvb3QgRzQwggIiMA0GCSqG
SIb3DQEBAQUAA4ICDwAwggIKAoICAQC/5pBzaN675F1KPDAiMGkz7MKnJS7JIT3y
ithZwuEppz1Yq3aaza57G4QNxDAf8xukOBbrVsaXbR2rsnnyyhHS5F/WBTxSD1If
xp4VpX6+n6lXFllVcq9ok3DCsrp1mWpzMpTREEQQLt+C8weE5nQ7bXHiLQwb7iDV
ySAdYyktzuxeTsiT+CFhmzTrBcZe7FsavOvJz82sNEBfsXpm7nfISKhmV1efVFiO
DCu3T6cw2Vbuyntd463JT17lNecxy9qTXtyOj4DatpGYQJB5w3jHtrHEtWoYOAMQ
jdjUN6QuBX2I9YI+EJFwq1WCQTLX2wRzKm6RAXwhTNS8rhsDdV14Ztk6MUSaM0C/
CNdaSaTC5qmgZ92kJ7yhTzm1EVgX9yRcRo9k98FpiHaYdj1ZXUJ2h4mXaXpI8OCi
EhtmmnTK3kse5w5jrubU75KSOp493ADkRSWJtppEGSt+wJS00mFt6zPZxd9LBADM
fRyVw4/3IbKyEbe7f/LVjHAsQWCqsWMYRJUadmJ+9oCw++hkpjPRiQfhvbfmQ6QY
uKZ3AeEPlAwhHbJUKSWJbOUOUlFHdL4mrLZBdd56rF+NP8m800ERElvlEFDrMcXK
chYiCd98THU/Y+whX8QgUWtvsauGi0/C1kVfnSD8oR7FwI+isX4KJpn15GkvmB0t
9dmpsh3lGwIDAQABo0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIB
hjAdBgNVHQ4EFgQU7NfjgtJxXWRM3y5nP+e6mK4cD08wDQYJKoZIhvcNAQEMBQAD
ggIBALth2X2pbL4XxJEbw6GiAI3jZGgPVs93rnD5/ZpKmbnJeFwMDF/k5hQpVgs2
SV1EY+CtnJYYZhsjDT156W1r1lT40jzBQ0CuHVD1UvyQO7uYmWlrx8GnqGikJ9yd
+SeuMIW59mdNOj6PWTkiU0TryF0Dyu1Qen1iIQqAyHNm0aAFYF/opbSnr6j3bTWc
fFqK1qI4mfN4i/RN0iAL3gTujJtHgXINwBQy7zBZLq7gcfJW5GqXb5JQbZaNaHqa
sjYUegbyJLkJEVDXCLG4iXqEI2FCKeWjzaIgQdfRnGTZ6iahixTXTBmyUEFxPT9N
cCOGDErcgdLMMpSEDQgJlxxPwO5rIHQw0uA5NBCFIRUBCOhVMt5xSdkoF1BN5r5N
0XWs0Mr7QbhDparTwwVETyw2m+L64kW4I1NsBm9nVX9GtUw/bihaeSbSpKhil9Ie
4u1Ki7wb/UdKDd9nZn6yW0HQO+T0O/QEY+nvwlQAUaCKKsnOeMzV6ocEGLPOr0mI
r/OSmbaz5mEP0oUA51Aa5BuVnRmhuZyxm7EAHu/QD09CbMkKvO5D+jpxpchNJqU1
/YldvIViHTLSoCtU7ZpXwdv6EM8Zt4tKG48BtieVU+i2iW1bvGjUI+iLUaJW+fCm
gKDWHrO8Dw9TdSmq6hN35N6MgSGtBxBHEa2HPQfRdbzP82Z+
-----END CERTIFICATE-----
`
export const DIGICERT_TRUSTED_ROOT_G4_SHA256 =
  '55:2F:7B:DC:F1:A7:AF:9E:6C:E6:72:01:7F:4F:12:AB:F7:72:40:C7:8E:76:1A:C2:03:D1:D9:D2:0A:C8:99:88'

/** How far genTime may be from the local clock. */
export const DEFAULT_MAX_SKEW_MS = 5 * 60_000

export type TimestampFailure =
  | 'malformed'
  | 'refused'
  | 'imprint'
  | 'nonce'
  | 'signature'
  | 'eku'
  | 'chain'
  | 'time'

/** Why a token was refused. Messages name the check, never anything about the document or its signers. */
export class TimestampVerificationError extends Error {
  constructor(readonly reason: TimestampFailure, message: string) {
    super(message)
    this.name = 'TimestampVerificationError'
  }
}

const fail = (reason: TimestampFailure, message: string): never => {
  throw new TimestampVerificationError(reason, message)
}

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  extKeyUsage: '2.5.29.37',
  subjectKeyIdentifier: '2.5.29.14',
  timeStamping: '1.3.6.1.5.5.7.3.8',
}

const DIGESTS: Record<string, string> = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
}
/** Hashes acceptable for the signer's signature (SHA-1 is too weak to vouch for a time). */
const SIGNING_DIGESTS = new Set(['sha256', 'sha384', 'sha512'])

/** Signature algorithms: RSA PKCS#1 v1.5 or ECDSA, with the hash they imply (if any). */
const SIGNATURES: Record<string, { kind: 'rsa' | 'ecdsa'; hash?: string }> = {
  '1.2.840.113549.1.1.1': { kind: 'rsa' },
  '1.2.840.113549.1.1.11': { kind: 'rsa', hash: 'sha256' },
  '1.2.840.113549.1.1.12': { kind: 'rsa', hash: 'sha384' },
  '1.2.840.113549.1.1.13': { kind: 'rsa', hash: 'sha512' },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', hash: 'sha256' },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', hash: 'sha384' },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', hash: 'sha512' },
}

// ── A minimal DER reader over the received bytes ─────────────────────────────

interface Tlv {
  /** The identifier octet: class, constructed bit and tag number. */
  tag: number
  /** The whole element, header included. */
  raw: Buffer
  /** The contents. */
  body: Buffer
}

const TAG = {
  boolean: 0x01,
  integer: 0x02,
  octetString: 0x04,
  oid: 0x06,
  sequence: 0x30,
  set: 0x31,
  generalizedTime: 0x18,
}
const ctxTag = (n: number, constructed: boolean) => 0x80 | (constructed ? 0x20 : 0) | n

function readTlv(buf: Buffer, offset: number): Tlv {
  if (offset + 2 > buf.length) fail('malformed', 'Timestamp token is truncated')
  const tag = buf[offset]
  if ((tag & 0x1f) === 0x1f) fail('malformed', 'Timestamp token uses an unsupported tag')
  let len = buf[offset + 1]
  let header = 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) fail('malformed', 'Timestamp token is not DER')
    if (offset + 2 + n > buf.length) fail('malformed', 'Timestamp token is truncated')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i]
    header += n
  }
  const end = offset + header + len
  if (end > buf.length) fail('malformed', 'Timestamp token is truncated')
  return { tag, raw: buf.subarray(offset, end), body: buf.subarray(offset + header, end) }
}

function children(t: Tlv): Tlv[] {
  if (!(t.tag & 0x20)) fail('malformed', 'Timestamp token has an unexpected primitive element')
  const out: Tlv[] = []
  for (let off = 0; off < t.body.length;) {
    const c = readTlv(t.body, off)
    out.push(c)
    off += c.raw.length
  }
  return out
}

function expectTag(t: Tlv | undefined, tag: number, what: string): Tlv {
  if (!t || t.tag !== tag) return fail('malformed', `Timestamp token: ${what} is missing or malformed`)
  return t
}

function oidOf(t: Tlv | undefined, what: string): string {
  const b = expectTag(t, TAG.oid, what).body
  if (!b.length) return fail('malformed', `Timestamp token: ${what} is empty`)
  const parts = [Math.floor(b[0] / 40), b[0] % 40]
  if (b[0] >= 80) { parts[0] = 2; parts[1] = b[0] - 80 }
  let v = 0
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f)
    if (!(b[i] & 0x80)) { parts.push(v); v = 0 }
  }
  return parts.join('.')
}

/** An INTEGER's value bytes without DER's sign padding, for comparing two encodings. */
function unsignedBytes(b: Buffer): Buffer {
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  return b.subarray(i)
}

function parseGeneralizedTime(t: Tlv): Date {
  const s = expectTag(t, TAG.generalizedTime, 'genTime').body.toString('latin1')
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[.,](\d{1,9}))?Z$/.exec(s)
  if (!m) return fail('malformed', 'Timestamp token: genTime is not a UTC GeneralizedTime')
  const ms = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms))
}

// ── Certificates ─────────────────────────────────────────────────────────────

interface CertInfo {
  x509: X509Certificate
  raw: Buffer
  issuer: Buffer
  serial: Buffer
  extensions: Map<string, { critical: boolean; value: Buffer }>
}

function readCertificate(t: Tlv): CertInfo {
  const raw = Buffer.from(t.raw)
  let x509: X509Certificate
  try {
    x509 = new X509Certificate(raw)
  } catch {
    return fail('malformed', 'Timestamp token carries an unreadable certificate')
  }
  const tbs = children(expectTag(children(t)[0], TAG.sequence, 'certificate'))
  let i = tbs[0]?.tag === ctxTag(0, true) ? 1 : 0 // optional [0] version
  const serial = expectTag(tbs[i++], TAG.integer, 'certificate serial').body
  i++ // signature algorithm
  const issuer = expectTag(tbs[i++], TAG.sequence, 'certificate issuer').raw
  const extensions = new Map<string, { critical: boolean; value: Buffer }>()
  const extWrapper = tbs.find((c) => c.tag === ctxTag(3, true))
  if (extWrapper) {
    for (const ext of children(expectTag(children(extWrapper)[0], TAG.sequence, 'certificate extensions'))) {
      const f = children(ext)
      const hasFlag = f[1]?.tag === TAG.boolean
      const critical = hasFlag && f[1].body[0] !== 0
      const value = expectTag(f[hasFlag ? 2 : 1], TAG.octetString, 'certificate extension').body
      extensions.set(oidOf(f[0], 'certificate extension id'), { critical, value })
    }
  }
  return { x509, raw, issuer, serial, extensions }
}

const validAt = (c: X509Certificate, at: Date) =>
  new Date(c.validFrom).getTime() <= at.getTime() && at.getTime() <= new Date(c.validTo).getTime()

/** Parses PEM text holding one or more certificates. Unreadable blocks are skipped. */
export function parseTrustPem(pem: string): X509Certificate[] {
  const blocks = pem.replace(/\\n/g, '\n').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  const out: X509Certificate[] = []
  for (const block of blocks) {
    try {
      out.push(new X509Certificate(block))
    } catch {
      console.error('[esign-seal] ESIGN_TSA_TRUST_PEM holds a certificate that cannot be read; ignoring it')
    }
  }
  return out
}

/** The bundled DigiCert root, plus any anchors in ESIGN_TSA_TRUST_PEM. */
export function defaultTrustAnchors(): X509Certificate[] {
  const anchors = [new X509Certificate(DIGICERT_TRUSTED_ROOT_G4_PEM)]
  const extra = process.env.ESIGN_TSA_TRUST_PEM
  if (extra) anchors.push(...parseTrustPem(extra))
  return anchors
}

/** Walks from the signer to an anchor through the token's own certificates; every link valid at `at`. */
function buildChain(signer: X509Certificate, pool: X509Certificate[], anchors: X509Certificate[], at: Date): void {
  const issuedBy = (child: X509Certificate, parent: X509Certificate) => {
    try {
      return child.checkIssued(parent) && child.verify(parent.publicKey)
    } catch {
      return false
    }
  }
  let current = signer
  const seen = new Set<string>()
  for (let depth = 0; depth < 8; depth++) {
    if (!validAt(current, at)) fail('chain', 'A certificate in the timestamp chain was not valid at genTime')
    if (anchors.some((a) => a.fingerprint256 === current.fingerprint256)) return
    const anchor = anchors.find((a) => issuedBy(current, a))
    if (anchor) {
      if (!validAt(anchor, at)) fail('chain', 'The timestamp trust anchor was not valid at genTime')
      return
    }
    seen.add(current.fingerprint256)
    const next = pool.find((c) => !seen.has(c.fingerprint256) && c.ca && issuedBy(current, c))
    if (!next) fail('chain', 'The timestamp certificate does not chain to a trusted root')
    current = next as X509Certificate
  }
  fail('chain', 'The timestamp certificate chain is too long')
}

// ── The token ────────────────────────────────────────────────────────────────

export interface VerifyTimestampOptions {
  /** The SHA-256 we asked the service to vouch for (raw bytes). */
  imprint: Buffer
  /** The nonce we sent (INTEGER value bytes). */
  nonce: Buffer
  trustAnchors?: X509Certificate[]
  now?: Date
  maxSkewMs?: number
}

export interface VerifiedTimestamp {
  genTime: Date
  /** The timestamp service's certificate subject, for the record. */
  signer: string
}

/** Verifies a TimeStampToken (a CMS ContentInfo, DER). Throws TimestampVerificationError on any failure. */
export function verifyTimestampToken(tokenDer: Buffer, opts: VerifyTimestampOptions): VerifiedTimestamp {
  try {
    return verifyToken(tokenDer, opts)
  } catch (err) {
    if (err instanceof TimestampVerificationError) throw err
    throw new TimestampVerificationError('malformed', 'Timestamp token cannot be read')
  }
}

function verifyToken(tokenDer: Buffer, opts: VerifyTimestampOptions): VerifiedTimestamp {
  const anchors = opts.trustAnchors ?? defaultTrustAnchors()
  const now = opts.now ?? new Date()
  const maxSkew = opts.maxSkewMs ?? DEFAULT_MAX_SKEW_MS

  const contentInfo = readTlv(tokenDer, 0)
  if (contentInfo.raw.length !== tokenDer.length) fail('malformed', 'Timestamp token has trailing bytes')
  const ci = children(expectTag(contentInfo, TAG.sequence, 'ContentInfo'))
  if (oidOf(ci[0], 'content type') !== OID.signedData) fail('malformed', 'Timestamp token is not CMS SignedData')
  const sd = children(expectTag(children(expectTag(ci[1], ctxTag(0, true), 'content'))[0], TAG.sequence, 'SignedData'))

  // SignedData: version, digestAlgorithms, encapContentInfo, [0] certificates, [1] crls, signerInfos
  const encap = children(expectTag(sd[2], TAG.sequence, 'encapContentInfo'))
  if (oidOf(encap[0], 'eContentType') !== OID.tstInfo) fail('malformed', 'Timestamp token does not hold a TSTInfo')
  const eContent = expectTag(children(expectTag(encap[1], ctxTag(0, true), 'eContent'))[0], TAG.octetString, 'eContent').body
  const certsTlv = sd.find((c) => c.tag === ctxTag(0, true))
  const certs = certsTlv ? children(certsTlv).filter((c) => c.tag === TAG.sequence).map(readCertificate) : []
  const signerInfos = children(expectTag(sd[sd.length - 1], TAG.set, 'signerInfos'))
  if (signerInfos.length !== 1) fail('malformed', 'Timestamp token must have exactly one signer')

  // TSTInfo: version, policy, messageImprint, serialNumber, genTime, accuracy?, ordering?, nonce?, [0] tsa?, [1] extensions?
  const tst = children(expectTag(readTlv(eContent, 0), TAG.sequence, 'TSTInfo'))
  const mi = children(expectTag(tst[2], TAG.sequence, 'messageImprint'))
  const miAlg = oidOf(children(expectTag(mi[0], TAG.sequence, 'imprint algorithm'))[0], 'imprint algorithm')
  const miHash = expectTag(mi[1], TAG.octetString, 'imprint').body
  if (miAlg !== OID.sha256 || !miHash.equals(opts.imprint)) fail('imprint', 'Timestamp is for a different hash')
  const genTime = parseGeneralizedTime(tst[4])
  const nonceTlv = tst.slice(5).find((c) => c.tag === TAG.integer)
  if (!nonceTlv || !unsignedBytes(nonceTlv.body).equals(unsignedBytes(opts.nonce))) {
    fail('nonce', 'Timestamp does not echo the nonce sent')
  }

  // SignerInfo: version, sid, digestAlgorithm, [0] signedAttrs, signatureAlgorithm, signature, [1] unsignedAttrs?
  const si = children(signerInfos[0])
  const sid = si[1]
  const digestName = DIGESTS[oidOf(children(expectTag(si[2], TAG.sequence, 'digestAlgorithm'))[0], 'digest algorithm')]
  if (!digestName || !SIGNING_DIGESTS.has(digestName)) fail('signature', 'Timestamp is signed with an unsupported hash')
  const signedAttrs = expectTag(si[3], ctxTag(0, true), 'signedAttrs')
  const sigAlg = SIGNATURES[oidOf(children(expectTag(si[4], TAG.sequence, 'signatureAlgorithm'))[0], 'signature algorithm')]
  if (!sigAlg) fail('signature', 'Timestamp uses an unsupported signature algorithm')
  if (sigAlg.hash && sigAlg.hash !== digestName) fail('signature', 'Timestamp signature and digest algorithms disagree')
  const signature = expectTag(si[5], TAG.octetString, 'signature').body

  // The signer certificate, by issuer and serial or by subject key identifier.
  const signer = certs.find((c) => {
    if (sid?.tag === TAG.sequence) {
      const [issuer, serial] = children(sid)
      return !!issuer && !!serial && c.issuer.equals(issuer.raw) && unsignedBytes(c.serial).equals(unsignedBytes(serial.body))
    }
    if (sid?.tag === ctxTag(0, false)) {
      const ski = c.extensions.get(OID.subjectKeyIdentifier)
      return !!ski && readTlv(ski.value, 0).body.equals(sid.body)
    }
    return false
  })
  if (!signer) return fail('chain', 'Timestamp token does not include its signer certificate')

  // Signed attributes: content type, message digest, and the signing certificate.
  const attrs = new Map<string, Tlv[]>()
  for (const a of children(signedAttrs)) {
    const [type, values] = children(a)
    attrs.set(oidOf(type, 'attribute type'), children(expectTag(values, TAG.set, 'attribute values')))
  }
  if (oidOf(attrs.get(OID.contentType)?.[0], 'contentType attribute') !== OID.tstInfo) {
    fail('signature', 'Timestamp contentType attribute is not TSTInfo')
  }
  const digest = expectTag(attrs.get(OID.messageDigest)?.[0], TAG.octetString, 'messageDigest attribute').body
  if (!digest.equals(createHash(digestName).update(eContent).digest())) {
    fail('signature', 'Timestamp messageDigest does not match its content')
  }
  checkSigningCertificate(attrs, signer.raw)

  // The signature covers the signed attributes encoded as a SET (RFC 5652 §5.4).
  const signedBytes = Buffer.concat([Buffer.from([TAG.set]), signedAttrs.raw.subarray(1)])
  let good = false
  try {
    good = cryptoVerify(
      digestName,
      signedBytes,
      sigAlg.kind === 'rsa'
        ? { key: signer.x509.publicKey, padding: cryptoConstants.RSA_PKCS1_PADDING }
        : { key: signer.x509.publicKey, dsaEncoding: 'der' },
      signature,
    )
  } catch {
    good = false
  }
  if (!good) fail('signature', 'Timestamp signature does not verify')

  // The signer must be a timestamping certificate (RFC 3161 §2.3: critical EKU, timeStamping).
  const eku = signer.extensions.get(OID.extKeyUsage)
  const purposes = eku ? children(readTlv(eku.value, 0)).map((p) => oidOf(p, 'key purpose')) : []
  if (!eku || !eku.critical || !purposes.includes(OID.timeStamping)) {
    fail('eku', 'Timestamp signer certificate is not for timestamping')
  }

  buildChain(signer.x509, certs.map((c) => c.x509), anchors, genTime)

  if (Math.abs(genTime.getTime() - now.getTime()) > maxSkew) fail('time', 'Timestamp time is too far from the local clock')

  return { genTime, signer: signer.x509.subject.replace(/\n/g, ', ') }
}

/** The ESS signing-certificate attribute (v1 SHA-1, or v2 with SHA-256 by default) must name the signer certificate. */
function checkSigningCertificate(attrs: Map<string, Tlv[]>, signerDer: Buffer): void {
  const v2 = attrs.get(OID.signingCertificateV2)?.[0]
  const v1 = attrs.get(OID.signingCertificate)?.[0]
  if (!v2 && !v1) fail('signature', 'Timestamp has no signing-certificate attribute')
  const firstCertId = (attr: Tlv) => children(expectTag(children(expectTag(attr, TAG.sequence, 'signing certificate'))[0], TAG.sequence, 'certificate ids'))[0]
  if (v2) {
    const id = children(expectTag(firstCertId(v2), TAG.sequence, 'ESSCertIDv2'))
    let alg = 'sha256'
    let i = 0
    if (id[0]?.tag === TAG.sequence) {
      alg = DIGESTS[oidOf(children(id[0])[0], 'ESSCertIDv2 hash algorithm')] ?? ''
      i = 1
    }
    const hash = expectTag(id[i], TAG.octetString, 'ESSCertIDv2 hash').body
    if (!alg || !hash.equals(createHash(alg).update(signerDer).digest())) {
      fail('signature', 'Timestamp signing-certificate attribute names another certificate')
    }
    return
  }
  const id = children(expectTag(firstCertId(v1 as Tlv), TAG.sequence, 'ESSCertID'))
  const hash = expectTag(id[0], TAG.octetString, 'ESSCertID hash').body
  if (!hash.equals(createHash('sha1').update(signerDer).digest())) {
    fail('signature', 'Timestamp signing-certificate attribute names another certificate')
  }
}
