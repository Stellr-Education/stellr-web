// Test-only: a throwaway RFC 3161 timestamp service, built at runtime, so the
// seal and verifier tests can answer a request for any hash and nonce. Keys are
// generated per run and never stored. Not imported by application code.
import { createHash, generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto'
import forge from 'node-forge'

const { asn1 } = forge
const seq = (v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, v)
const set = (v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, v)
const oid = (o: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(o).getBytes())
const octets = (b: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, b)
const int = (b: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, b)
const nul = () => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')
const ctx = (tag: number, v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, true, v)
const attribute = (type: string, value: forge.asn1.Asn1) => seq([oid(type), set([value])])
const der = (a: forge.asn1.Asn1) => asn1.toDer(a).getBytes()
const sha256 = (b: string) => createHash('sha256').update(Buffer.from(b, 'binary')).digest().toString('binary')

function keyPair(): { key: KeyObject; forgePrivate: forge.pki.rsa.PrivateKey; forgePublic: forge.pki.rsa.PublicKey } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    key: privateKey,
    forgePrivate: forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }) as string),
    forgePublic: forge.pki.publicKeyFromPem(publicKey.export({ type: 'pkcs1', format: 'pem' }) as string),
  }
}

export interface TestTsa {
  /** Trust this to accept the service's tokens. */
  anchors: X509Certificate[]
  rootPem: string
  signer: forge.pki.Certificate
  signerKey: KeyObject
  /** Certificates the token carries: the signer, then its issuer. */
  certs: forge.pki.Certificate[]
}

/** A root and a signer issued by it. `eku: false` leaves out the timeStamping usage; `ekuCritical: false` keeps it but not critical. */
export function makeTestTsa(opts: { eku?: boolean; ekuCritical?: boolean; name?: string } = {}): TestTsa {
  const name = opts.name ?? 'Stellr test TSA (placeholder)'
  const rootKeys = keyPair()
  const root = forge.pki.createCertificate()
  root.publicKey = rootKeys.forgePublic
  root.serialNumber = '01'
  root.validity.notBefore = new Date('2020-01-01T00:00:00Z')
  root.validity.notAfter = new Date('2040-01-01T00:00:00Z')
  root.setSubject([{ name: 'commonName', value: `${name} root` }])
  root.setIssuer([{ name: 'commonName', value: `${name} root` }])
  root.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  ])
  root.sign(rootKeys.forgePrivate, forge.md.sha256.create())

  const signerKeys = keyPair()
  const signer = forge.pki.createCertificate()
  signer.publicKey = signerKeys.forgePublic
  signer.serialNumber = '02'
  signer.validity.notBefore = new Date('2020-01-01T00:00:00Z')
  signer.validity.notAfter = new Date('2040-01-01T00:00:00Z')
  signer.setSubject([{ name: 'commonName', value: `${name} signer` }])
  signer.setIssuer(root.subject.attributes)
  const extensions: object[] = [
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, critical: true },
  ]
  if (opts.eku !== false) extensions.push({ name: 'extKeyUsage', timeStamping: true, critical: opts.ekuCritical !== false })
  signer.setExtensions(extensions)
  signer.sign(rootKeys.forgePrivate, forge.md.sha256.create())

  const rootPem = forge.pki.certificateToPem(root)
  return { anchors: [new X509Certificate(rootPem)], rootPem, signer, signerKey: signerKeys.key, certs: [signer, root] }
}

export interface TokenRequest {
  /** SHA-256 imprint, binary string. */
  imprint: string
  /** Nonce INTEGER value bytes, binary string. */
  nonce: string
  genTime?: Date
  status?: number
  /** Corrupt the signature after signing. */
  breakSignature?: boolean
}

/** A TimeStampResp (DER, binary string) signed by `tsa`, with an ESSCertIDv2 signing-certificate attribute. */
export function tsaResponse(tsa: TestTsa, req: TokenRequest): string {
  const status = req.status ?? 0
  if (status !== 0 && status !== 1) return der(seq([seq([int(String.fromCharCode(status))])]))
  const tstInfo = seq([
    int(String.fromCharCode(1)),
    oid('1.3.6.1.4.1.99999.1'),
    seq([seq([oid('2.16.840.1.101.3.4.2.1'), nul()]), octets(req.imprint)]),
    int(String.fromCharCode(0x2a)),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(req.genTime ?? new Date())),
    int(req.nonce),
  ])
  const eContent = der(tstInfo)
  const signerDer = der(forge.pki.certificateToAsn1(tsa.signer))
  const signedAttrs = [
    attribute('1.2.840.113549.1.9.3', oid('1.2.840.113549.1.9.16.1.4')),
    attribute('1.2.840.113549.1.9.4', octets(sha256(eContent))),
    attribute('1.2.840.113549.1.9.16.2.47', seq([seq([seq([octets(sha256(signerDer))])])])),
  ]
  const sig = sign('sha256', Buffer.from(der(set(signedAttrs)), 'binary'), tsa.signerKey)
  if (req.breakSignature) sig[sig.length - 1] ^= 0x01
  const signerInfo = seq([
    int(String.fromCharCode(1)),
    seq([forge.pki.distinguishedNameToAsn1(tsa.signer.issuer), int(forge.util.hexToBytes(tsa.signer.serialNumber))]),
    seq([oid('2.16.840.1.101.3.4.2.1'), nul()]),
    ctx(0, signedAttrs),
    seq([oid('1.2.840.113549.1.1.1'), nul()]),
    octets(sig.toString('binary')),
  ])
  const token = seq([oid('1.2.840.113549.1.7.2'), ctx(0, [seq([
    int(String.fromCharCode(3)),
    set([seq([oid('2.16.840.1.101.3.4.2.1'), nul()])]),
    seq([oid('1.2.840.113549.1.9.16.1.4'), ctx(0, [octets(eContent)])]),
    ctx(0, tsa.certs.map((c) => forge.pki.certificateToAsn1(c))),
    set([signerInfo]),
  ])])])
  return der(seq([seq([int(String.fromCharCode(status))]), token]))
}

/** Reads the imprint and nonce out of a TimeStampReq body, as the service would. */
export function readRequest(body: Buffer): { imprint: string; nonce: string } {
  const req = asn1.fromDer(body.toString('binary')).value as forge.asn1.Asn1[]
  return {
    imprint: (req[1].value as forge.asn1.Asn1[])[1].value as string,
    nonce: req[2].value as string,
  }
}
