import { describe, expect, it } from 'vitest'
import { buildMime, encodeAddress, encodeHeader } from './mime'

const msg = {
  from: '"Example via Stellr" <no-reply@mail.stellreducation.org>',
  to: ['a@example.org'], cc: [], replyTo: 'office@example.org',
  subject: 'Café night', html: '<p>Hi</p>', text: 'Hi',
  headers: { 'List-Unsubscribe': '<https://x.test/u>' },
  attachments: [{ filename: 'a.ics', content: 'QUJD', contentType: 'text/calendar' }],
}

describe('MIME', () => {
  it('encodes non-ASCII headers and leaves ASCII alone', () => {
    expect(encodeHeader('Hello')).toBe('Hello')
    expect(encodeHeader('Café')).toBe(`=?UTF-8?B?${Buffer.from('Café').toString('base64')}?=`)
    expect(encodeHeader('a\r\nBcc: x@y')).toBe('a Bcc: x@y')
    expect(encodeAddress('"Zoë" <z@example.org>')).toBe(`=?UTF-8?B?${Buffer.from('Zoë').toString('base64')}?= <z@example.org>`)
  })
  it('builds headers, both bodies and the attachment', () => {
    const raw = Buffer.from(buildMime(msg, new Date('2026-11-24T00:00:00Z'))).toString('utf8')
    expect(raw).toContain('From: "Example via Stellr" <no-reply@mail.stellreducation.org>')
    expect(raw).toContain('Reply-To: office@example.org')
    expect(raw).toContain('List-Unsubscribe: <https://x.test/u>')
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8')
    expect(raw).toContain('Content-Type: text/html; charset=UTF-8')
    expect(raw).toContain('filename="a.ics"')
    expect(raw).toContain(Buffer.from('<p>Hi</p>').toString('base64'))
    expect(raw).not.toMatch(/^Cc:/m)
  })
})
