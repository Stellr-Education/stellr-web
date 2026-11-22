import { describe, expect, it } from 'vitest'
import { downloadErrorText, fallbackFilename, filenameFromDisposition, isReverificationHint } from './step-up-download'

describe('isReverificationHint', () => {
  it('matches Clerk’s reverification error body only', () => {
    expect(isReverificationHint({ clerk_error: { type: 'forbidden', reason: 'reverification-error', metadata: {} } })).toBe(true)
    expect(isReverificationHint({ clerk_error: { type: 'forbidden', reason: 'other' } })).toBe(false)
    expect(isReverificationHint({ error: 'Forbidden' })).toBe(false)
    expect(isReverificationHint(null)).toBe(false)
    expect(isReverificationHint('x')).toBe(false)
  })
})

describe('filenameFromDisposition', () => {
  it('reads the quoted, bare and UTF-8 forms', () => {
    expect(filenameFromDisposition('attachment; filename="stellr-members-2026-11-21.csv"')).toBe('stellr-members-2026-11-21.csv')
    expect(filenameFromDisposition('attachment; filename=report.pdf')).toBe('report.pdf')
    expect(filenameFromDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf")).toBe('résumé.pdf')
    expect(filenameFromDisposition('attachment')).toBeNull()
    expect(filenameFromDisposition(null)).toBeNull()
  })
})

describe('fallbackFilename', () => {
  it('takes the last path segment', () => {
    expect(fallbackFilename('/api/admin/members/export?x=1')).toBe('export')
    expect(fallbackFilename('')).toBe('download')
  })
})

describe('downloadErrorText', () => {
  it('uses the route’s error, or a plain line with the status', async () => {
    expect(await downloadErrorText(new Response(JSON.stringify({ error: 'No mentors at this event yet' }), { status: 400 }))).toBe('No mentors at this event yet')
    expect(await downloadErrorText(new Response('boom', { status: 502 }))).toMatch(/\(502\)/)
  })
})
