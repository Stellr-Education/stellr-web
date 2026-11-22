// @vitest-environment node
import { NextRequest, type NextFetchEvent } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Active CPU (21 Nov 2026): requests that read no session skip clerkMiddleware,
// and scanner probes stop before it. Clerk is stubbed and counts its runs.

const APP = 'app.placeholder.test'
const WWW = 'www.placeholder.test'
const clerkRuns = vi.hoisted(() => ({ n: 0 }))

vi.mock('@clerk/nextjs/server', () => {
  const toRegex = (p: string) => new RegExp('^' + p.replace(/:[a-z]+/gi, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
  return {
    createRouteMatcher: (patterns: string[]) => (req: Request) =>
      patterns.some((p) => toRegex(p).test(new URL(req.url).pathname)),
    clerkMiddleware:
      (handler: (auth: unknown, req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>) =>
      (req: NextRequest, event: NextFetchEvent) => {
        clerkRuns.n += 1
        const auth = Object.assign(async () => ({ userId: null, sessionClaims: null }), { protect: async () => {} })
        return handler(auth, req, event)
      },
  }
})
vi.mock('@/lib/env', () => ({ APP_HOST: 'app.placeholder.test', SITE_URL: 'https://www.placeholder.test' }))
vi.mock('@/lib/crawlers', () => ({ matchCrawler: () => null, recordCrawlerHit: async () => {} }))

import proxy from '@/proxy'

const event = { waitUntil: () => {} } as unknown as NextFetchEvent
const hit = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }), event)

beforeEach(() => {
  vi.stubEnv('TENANT_ROUTING_ENABLED', '')
  clerkRuns.n = 0
})

describe('proxy: session-free requests skip Clerk', () => {
  it.each([
    [WWW, '/robots.txt'],
    [APP, '/robots.txt'],
    [WWW, '/sitemap.xml'],
    [WWW, '/llms.txt'],
    [WWW, '/indexnow-key.txt'],
    [WWW, '/classroom-qualifier'],
    [WWW, '/classroom-qualifier/stories/sample-story'],
  ])('%s%s passes through without Clerk', async (host, path) => {
    const res = await hit(host, path)
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(clerkRuns.n).toBe(0)
  })

  it.each([
    [WWW, '/register/sample-event'],
    [WWW, '/grant'],
    [APP, '/classroom-qualifier'],
    [WWW, '/robots.txt/extra'],
    [WWW, '/sign-in'],
  ])('%s%s still runs Clerk', async (host, path) => {
    await hit(host, path)
    expect(clerkRuns.n).toBe(1)
  })
})

describe('proxy: scanner probes stop before Clerk', () => {
  it.each(['/wp-admin', '/wp-login.php', '/wp-content/plugins/x', '/xmlrpc.php', '/.env', '/.env.production', '/.git/config', '/index.php', '/admin/config.php', '/phpmyadmin/'])(
    '%s is a plain 404',
    async (path) => {
      const res = await hit(WWW, path)
      expect(res.status).toBe(404)
      expect(clerkRuns.n).toBe(0)
    },
  )

  it.each(['/admin', '/events/wp-sample', '/news/php-workshop', '/environment', '/gitlab'])('%s is not a probe', async (path) => {
    const res = await hit(WWW, path)
    expect(res.status).not.toBe(404)
  })
})
