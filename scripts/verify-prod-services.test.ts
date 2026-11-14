import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gtmInitScript } from '../lib/gtm'
import {
  DEV_SUPABASE_REF,
  envFileArg,
  productionDecision,
  refusalMessage,
  sameOriginScriptUrls,
  scriptHasGtmLoader,
} from './lib/verify-prod-env'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

// verify-prod-stale / backlog-batch1.24 / legacy-7: verify:prod read .env.local
// (dev credentials) and reported on dev under a production banner, and its GTM
// check looked for a <noscript> iframe GoogleTagManager.tsx deliberately does
// not render. Test secrets are built at runtime and say "placeholder".

const LIVE_KEY = ['sk', 'live', 'placeholder000'].join('_')
const TEST_KEY = ['sk', 'test', 'placeholder000'].join('_')
const PROD = {
  NEXT_PUBLIC_APP_ENV: 'prod',
  STRIPE_SECRET_KEY: LIVE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
}

describe('envFileArg', () => {
  it('reads --env-file <path> and --env-file=<path>', () => {
    expect(envFileArg(['--env-file', '/tmp/prod.env'])).toBe('/tmp/prod.env')
    expect(envFileArg(['--env-file=/tmp/prod.env'])).toBe('/tmp/prod.env')
  })
  it('is null when absent, empty, or followed by another flag — there is no default file', () => {
    expect(envFileArg([])).toBeNull()
    expect(envFileArg(['--env-file'])).toBeNull()
    expect(envFileArg(['--env-file='])).toBeNull()
    expect(envFileArg(['--env-file', '--other'])).toBeNull()
  })
})

describe('productionDecision', () => {
  it('accepts an environment that is production by every signal', () => {
    expect(productionDecision(PROD)).toEqual({ ok: true })
  })

  it('refuses a dev .env.local: dev APP_ENV, sk_test_ key, the dev Supabase project', () => {
    const d = productionDecision({
      NEXT_PUBLIC_APP_ENV: 'dev',
      STRIPE_SECRET_KEY: TEST_KEY,
      NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_SUPABASE_REF}.supabase.co`,
    })
    expect(d.ok).toBe(false)
    if (d.ok) return
    expect(d.reasons).toHaveLength(3)
    expect(d.reasons.join('\n')).toMatch(/NEXT_PUBLIC_APP_ENV is "dev"/)
    expect(d.reasons.join('\n')).toMatch(/test key/)
    expect(d.reasons.join('\n')).toMatch(/dev Supabase project/)
  })

  it.each([
    ['APP_ENV unset', { NEXT_PUBLIC_APP_ENV: undefined }, /NEXT_PUBLIC_APP_ENV is not set/],
    ['APP_ENV dev', { NEXT_PUBLIC_APP_ENV: 'dev' }, /not "prod"/],
    ['Stripe key missing (a vercel pull leaves it empty)', { STRIPE_SECRET_KEY: '' }, /STRIPE_SECRET_KEY is not set/],
    ['Stripe test key', { STRIPE_SECRET_KEY: TEST_KEY }, /test key/],
    ['Stripe restricted key', { STRIPE_SECRET_KEY: 'rk_live_placeholder' }, /not a live key/],
    ['Supabase unset', { NEXT_PUBLIC_SUPABASE_URL: undefined }, /NEXT_PUBLIC_SUPABASE_URL is not set/],
    ['Supabase dev project', { NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_SUPABASE_REF}.supabase.co` }, /dev Supabase project/],
    ['Supabase local stack', { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, /does not name the production/],
  ])('refuses when only one signal is wrong: %s', (_label, change, reason) => {
    const d = productionDecision({ ...PROD, ...change })
    expect(d.ok).toBe(false)
    if (d.ok) return
    expect(d.reasons).toHaveLength(1)
    expect(d.reasons[0]).toMatch(reason)
  })

  it('never echoes a secret value in its reasons', () => {
    const d = productionDecision({ ...PROD, STRIPE_SECRET_KEY: TEST_KEY })
    expect(JSON.stringify(d)).not.toContain('placeholder000')
  })
})

describe('refusalMessage', () => {
  it('says how to run it and that .env.local is never read', () => {
    const m = refusalMessage({ envFile: null })
    expect(m).toMatch(/no --env-file given/)
    expect(m).toMatch(/--environment=production/)
    expect(m).toMatch(/\.env\.local is never read/)
  })
  it('lists each reason', () => {
    const m = refusalMessage({ envFile: 'x.env', reasons: ['a', 'b'] })
    expect(m).toMatch(/x\.env is not a production environment/)
    expect(m).toMatch(/- a\n {2}- b/)
  })
})

// A sample of the rendered head as the live site serves it (chunk names
// changed): the HTML carries script tags and no GTM id at all, and the loader
// sits in a client chunk as next/script's children, folded by the bundler.
const SAMPLE_HEAD =
  '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>' +
  '<link rel="preload" href="/_next/static/media/font-placeholder.woff2" as="font" crossorigin="" type="font/woff2"/>' +
  '<script src="/_next/static/immutable/chunks/aaa111.js" async=""></script>' +
  '<script src="/_next/static/immutable/chunks/bbb222.js?dpl=placeholder&amp;v=1" async=""></script>' +
  '<script src="https://cdn.example.net/tracker-placeholder.js" async=""></script>' +
  '<script>(function(){ window.dataLayer = window.dataLayer || []; })()</script>' +
  '</head><body></body></html>'

const SAMPLE_CHUNK =
  'function S(){return(0,t.jsx)(_.default,{id:"gtm-init",strategy:"lazyOnload",children:"' +
  "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
  "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';" +
  "j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);" +
  "})(window,document,'script','dataLayer','GTM-TEST123');" +
  '"})}function k({portalId:e}){}'

describe('sameOriginScriptUrls', () => {
  it('returns the page\'s own script chunks, resolved, and skips other origins and inline scripts', () => {
    expect(sameOriginScriptUrls(SAMPLE_HEAD, 'https://www.example.org/')).toEqual([
      'https://www.example.org/_next/static/immutable/chunks/aaa111.js',
      'https://www.example.org/_next/static/immutable/chunks/bbb222.js?dpl=placeholder&v=1',
    ])
  })
})

describe('scriptHasGtmLoader', () => {
  const loader = gtmInitScript('GTM-TEST123')

  it('finds the loader GoogleTagManager renders, for the expected container', () => {
    expect(scriptHasGtmLoader(SAMPLE_CHUNK, 'GTM-TEST123', loader)).toBe(true)
  })

  it('still finds it if a bundler re-quotes the literal', () => {
    const requoted = SAMPLE_CHUNK.replace("'script','dataLayer','GTM-TEST123'", '"script","dataLayer","GTM-TEST123"')
    expect(requoted).not.toContain(loader)
    expect(scriptHasGtmLoader(requoted, 'GTM-TEST123', loader)).toBe(true)
  })

  it('does not match a different container', () => {
    expect(scriptHasGtmLoader(SAMPLE_CHUNK, 'GTM-OTHER99', gtmInitScript('GTM-OTHER99'))).toBe(false)
  })

  it('does not match the HTML itself, which carries no loader (why the <noscript> check was always wrong)', () => {
    expect(scriptHasGtmLoader(SAMPLE_HEAD, 'GTM-TEST123', loader)).toBe(false)
    expect(SAMPLE_HEAD).not.toMatch(/ns\.html\?id=/)
  })
})

describe('verify-prod-services.ts refuses before any check runs', () => {
  const script = resolve(__dirname, 'verify-prod-services.ts')
  const tsx = resolve(__dirname, '../node_modules/.bin/tsx')
  // A clean environment: only what the file supplies can count.
  const run = (args: string[]) =>
    spawnSync(tsx, [script, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test' },
      timeout: 60_000,
    })

  it('with no --env-file (it never falls back to .env.local)', () => {
    const r = run([])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/no --env-file given/)
    expect(r.stdout).not.toMatch(/STRIPE|DOCUSIGN|ANALYTICS/)
  }, 60_000)

  it('with an env file holding dev credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-prod-'))
    const file = join(dir, 'dev.env')
    writeFileSync(
      file,
      [
        'NEXT_PUBLIC_APP_ENV=dev',
        `STRIPE_SECRET_KEY=${TEST_KEY}`,
        `NEXT_PUBLIC_SUPABASE_URL=https://${DEV_SUPABASE_REF}.supabase.co`,
      ].join('\n'),
    )
    try {
      const r = run(['--env-file', file])
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/is not a production environment/)
      expect(r.stderr).toMatch(/dev Supabase project/)
      expect(r.stderr).not.toContain('placeholder000')
      expect(r.stdout).not.toMatch(/STRIPE|DOCUSIGN|ANALYTICS/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
