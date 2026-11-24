// Amazon SNS message signatures, for the SES standby's webhook (email plan F).
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
//
// The signing certificate is fetched only from an SNS host over https, and the
// string to sign is built from the fields AWS lists for each message type.
// SignatureVersion 1 is SHA1withRSA, 2 is SHA256withRSA.

import { createVerify } from 'node:crypto'

export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation' | string
  MessageId: string
  TopicArn: string
  Message: string
  Timestamp: string
  SignatureVersion: string
  Signature: string
  SigningCertURL: string
  Subject?: string
  SubscribeURL?: string
  Token?: string
}

const CERT_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/[^?#]+\.pem$/
const SUBSCRIBE_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\//

export const isSnsCertUrl = (url: string) => CERT_URL.test(url)
export const isSnsSubscribeUrl = (url: string) => SUBSCRIBE_URL.test(url)

/** The canonical string AWS signs, for this message's type. */
export function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === 'Notification'
      ? ['Message', 'MessageId', ...(m.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  return keys.map((k) => `${k}\n${(m as unknown as Record<string, string>)[k] ?? ''}\n`).join('')
}

const certCache = new Map<string, string>()

async function fetchCert(url: string, fetcher: typeof fetch): Promise<string> {
  const hit = certCache.get(url)
  if (hit) return hit
  const res = await fetcher(url)
  if (!res.ok) throw new Error(`certificate fetch failed: ${res.status}`)
  const pem = await res.text()
  if (!pem.includes('BEGIN CERTIFICATE') && !pem.includes('BEGIN PUBLIC KEY')) throw new Error('not a certificate')
  certCache.set(url, pem)
  return pem
}

/** True only for a well-formed message signed by SNS. Never throws. */
export async function verifySnsMessage(m: unknown, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const msg = m as SnsMessage
    if (!msg || typeof msg !== 'object') return false
    for (const k of ['Type', 'MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'] as const) {
      if (typeof msg[k] !== 'string') return false
    }
    if (!isSnsCertUrl(msg.SigningCertURL)) return false
    const algorithm = msg.SignatureVersion === '1' ? 'RSA-SHA1' : msg.SignatureVersion === '2' ? 'RSA-SHA256' : null
    if (!algorithm) return false
    const pem = await fetchCert(msg.SigningCertURL, fetcher)
    const verifier = createVerify(algorithm)
    verifier.update(stringToSign(msg), 'utf8')
    return verifier.verify(pem, msg.Signature, 'base64')
  } catch {
    return false
  }
}

/** For tests. */
export function clearSnsCertCache(): void {
  certCache.clear()
}
