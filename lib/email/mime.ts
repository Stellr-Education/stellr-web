// A minimal MIME builder for the SES standby (lib/email/transport-ses.ts), which
// sends raw messages so headers (List-Unsubscribe) and attachments go exactly as
// they would through Resend. multipart/mixed holding multipart/alternative
// (text, then HTML) and any base64 attachments. Header values that are not plain
// ASCII are RFC 2047 encoded; line breaks are stripped from every header value.

import { randomBytes } from 'node:crypto'
import type { OutgoingEmail } from './transport'

const CRLF = '\r\n'

function clean(v: string): string {
  return v.replace(/[\r\n]+/g, ' ')
}

/** RFC 2047 base64 encoded-word when the value has non-ASCII characters. */
export function encodeHeader(v: string): string {
  const s = clean(v)
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`
}

/** "Name <a@b>" with the display name encoded when needed; a bare address stays bare. */
export function encodeAddress(v: string): string {
  const m = clean(v).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (!m) return clean(v).trim()
  const name = m[1].trim()
  if (!name) return `<${m[2].trim()}>`
  const encoded = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeHeader(name)
  return `${encoded} <${m[2].trim()}>`
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, (line) => line + CRLF).trimEnd()
}

const b64 = (s: string) => wrap76(Buffer.from(s, 'utf8').toString('base64'))
const boundary = (tag: string) => `=_stellr_${tag}_${randomBytes(12).toString('hex')}`

/** The whole message as bytes, ready for SESv2 Content.Raw. */
export function buildMime(message: OutgoingEmail, now = new Date()): Uint8Array {
  const mixed = boundary('mixed')
  const alt = boundary('alt')
  const headers: string[] = [
    `From: ${encodeAddress(message.from)}`,
    `To: ${message.to.map(encodeAddress).join(', ')}`,
    ...(message.cc.length ? [`Cc: ${message.cc.map(encodeAddress).join(', ')}`] : []),
    `Reply-To: ${encodeAddress(message.replyTo)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    'MIME-Version: 1.0',
    ...Object.entries(message.headers ?? {}).map(([k, v]) => `${clean(k).replace(/:/g, '')}: ${encodeHeader(v)}`),
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ]
  const parts: string[] = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(message.text),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(message.html),
    `--${alt}--`,
  ]
  for (const a of message.attachments ?? []) {
    const name = encodeHeader(a.filename.replace(/["\\]/g, ''))
    parts.push(
      `--${mixed}`,
      `Content-Type: ${clean(a.contentType ?? 'application/octet-stream')}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrap76(a.content.replace(/\s+/g, '')),
    )
  }
  parts.push(`--${mixed}--`, '')
  return Buffer.from([...headers, '', ...parts].join(CRLF), 'utf8')
}
