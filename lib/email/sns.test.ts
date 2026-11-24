// @vitest-environment node
import { generateKeyPairSync, createSign } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSnsCertCache, isSnsCertUrl, isSnsSubscribeUrl, stringToSign, verifySnsMessage, type SnsMessage } from './sns'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const CERT = 'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-abc.pem'

function signed(m: Omit<SnsMessage, 'Signature' | 'SignatureVersion' | 'SigningCertURL'>, version = '2'): SnsMessage {
  const full = { ...m, SignatureVersion: version, SigningCertURL: CERT, Signature: '' } as SnsMessage
  const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256')
  signer.update(stringToSign(full))
  return { ...full, Signature: signer.sign(privateKey, 'base64') }
}

const base = { Type: 'Notification', MessageId: 'm1', TopicArn: 'arn:aws:sns:us-east-2:1:t', Message: '{"a":1}', Timestamp: '2026-11-24T00:00:00Z' }
let fetcher: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearSnsCertCache()
  fetcher = vi.fn(async () => ({ ok: true, text: async () => pem }))
})

describe('verifySnsMessage', () => {
  it('accepts a message signed with SignatureVersion 1 or 2', async () => {
    expect(await verifySnsMessage(signed(base), fetcher as never)).toBe(true)
    expect(await verifySnsMessage(signed(base, '1'), fetcher as never)).toBe(true)
  })
  it('refuses a changed message', async () => {
    expect(await verifySnsMessage({ ...signed(base), Message: '{"a":2}' }, fetcher as never)).toBe(false)
  })
  it('never fetches a certificate from anywhere but SNS', async () => {
    expect(await verifySnsMessage({ ...signed(base), SigningCertURL: 'https://evil.example/cert.pem' }, fetcher as never)).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses junk without throwing', async () => {
    expect(await verifySnsMessage(null, fetcher as never)).toBe(false)
    expect(await verifySnsMessage({ Type: 'Notification' }, fetcher as never)).toBe(false)
  })
  it('signs a subscription confirmation over its own fields', async () => {
    const sub = signed({ ...base, Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.us-east-2.amazonaws.com/?Action=ConfirmSubscription', Token: 'tok' } as never)
    expect(await verifySnsMessage(sub, fetcher as never)).toBe(true)
  })
})

describe('SNS URLs', () => {
  it('only allows SNS hosts', () => {
    expect(isSnsCertUrl(CERT)).toBe(true)
    expect(isSnsCertUrl('http://sns.us-east-2.amazonaws.com/x.pem')).toBe(false)
    expect(isSnsCertUrl('https://sns.us-east-2.amazonaws.com.evil.com/x.pem')).toBe(false)
    expect(isSnsSubscribeUrl('https://sns.us-east-2.amazonaws.com/?Action=x')).toBe(true)
    expect(isSnsSubscribeUrl('https://example.com/?Action=x')).toBe(false)
  })
})
