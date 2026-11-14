// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import nextConfig, { studioRedirects } from '../next.config.mjs'

// Vercel retention .6 / legacy 6.5: the Studio left the Next app for Sanity's
// hosting (docs/RUNBOOK-sanity-studio.md). /studio redirects there when
// NEXT_PUBLIC_SANITY_STUDIO_URL is set at build, and is the normal 404 otherwise.

describe('hosted Sanity Studio', () => {
  it('the embedded Studio route is gone', () => {
    expect(existsSync('app/(stellr)/studio')).toBe(false)
  })

  it('redirects /studio and everything under it to the hosted Studio, on Stellr hosts only', () => {
    const [rule, ...rest] = studioRedirects({ NEXT_PUBLIC_SANITY_STUDIO_URL: 'https://placeholder-host.sanity.studio/' })
    expect(rest).toEqual([])
    expect(rule).toMatchObject({
      source: '/studio/:path*',
      destination: 'https://placeholder-host.sanity.studio/:path*',
      permanent: false,
    })
    const host = new RegExp(`^${rule.has[0].value}$`)
    expect(host.test('www.stellreducation.org')).toBe(true)
    expect(host.test('app.stellreducation.org')).toBe(true)
    expect(host.test('tenant.example.org')).toBe(false)
  })

  it('keeps a path on the Studio URL', () => {
    const [rule] = studioRedirects({ NEXT_PUBLIC_SANITY_STUDIO_URL: 'https://placeholder.example/studio/' })
    expect(rule.destination).toBe('https://placeholder.example/studio/:path*')
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not a URL', 'placeholder-host.sanity.studio'],
    ['http', 'http://placeholder-host.sanity.studio'],
    ['with credentials', 'https://user:placeholder@placeholder-host.sanity.studio'],
  ])('adds no rule when the variable is %s', (_label, value) => {
    expect(studioRedirects({ NEXT_PUBLIC_SANITY_STUDIO_URL: value })).toEqual([])
  })

  it('the build reads the rule from its own environment', async () => {
    const before = process.env.NEXT_PUBLIC_SANITY_STUDIO_URL
    try {
      delete process.env.NEXT_PUBLIC_SANITY_STUDIO_URL
      const without = (await nextConfig.redirects!()) as { source: string }[]
      expect(without.some((r) => r.source.startsWith('/studio'))).toBe(false)
      process.env.NEXT_PUBLIC_SANITY_STUDIO_URL = 'https://placeholder-host.sanity.studio'
      const withUrl = (await nextConfig.redirects!()) as { source: string; destination: string }[]
      expect(withUrl.find((r) => r.source === '/studio/:path*')?.destination).toBe('https://placeholder-host.sanity.studio/:path*')
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_SANITY_STUDIO_URL
      else process.env.NEXT_PUBLIC_SANITY_STUDIO_URL = before
    }
  })

  it('the CLI takes the Studio hostname from SANITY_STUDIO_HOSTNAME and guesses none', () => {
    const cli = readFileSync('sanity.cli.ts', 'utf8')
    expect(cli).toMatch(/studioHost\s*=\s*process\.env\.SANITY_STUDIO_HOSTNAME \|\| undefined/)
    expect(cli).not.toMatch(/\.sanity\.studio['"`]/)
  })

  it('the Studio config serves from its own root and reads the variables its build inlines', () => {
    const config = readFileSync('sanity.config.ts', 'utf8')
    expect(config).toContain("basePath: '/'")
    expect(config).toContain('process.env.SANITY_STUDIO_PROJECT_ID')
  })
})
