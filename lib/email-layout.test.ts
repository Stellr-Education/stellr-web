// @vitest-environment node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { emailLayout } from './email-layout'

// 20 Nov 2026: every email built on this layout pointed at /stellr-logo.png,
// which never existed on the site, so the header logo showed as a broken image.
describe('emailLayout logo', () => {
  it('points at a PNG that ships in public/', () => {
    const html = emailLayout({ heading: 'Hi', bodyHtml: '<p>Body</p>' })
    const src = html.match(/<img src="([^"]+)" alt="Stellr Education"/)?.[1]
    expect(src).toBeDefined()
    const pathname = new URL(src!).pathname
    expect(pathname).toBe('/images/stellr-logo.png')
    expect(existsSync(path.join(process.cwd(), 'public', pathname))).toBe(true)
  })
})
