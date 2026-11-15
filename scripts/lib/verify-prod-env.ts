/**
 * The decisions scripts/verify-prod-services.ts makes before and during its run,
 * kept pure so they can be tested without credentials or a network.
 *
 * WHY (verify-prod-stale, backlog-batch1.24, legacy-7): the script loaded
 * .env.local implicitly. A worktree's .env.local holds DEV credentials (the
 * production guard, scripts/production-guard.mjs, refuses to start a dev
 * server on anything else), so `npm run verify:prod` reported on the dev
 * Supabase project and the test Stripe account under a "production
 * verification" banner. It now takes credentials only from a file named on the
 * command line, and refuses unless every signal in that file says production.
 */

import { PRODUCTION_SUPABASE_REF } from '../production-guard.mjs'

/** The dev Supabase project. Never production. */
export const DEV_SUPABASE_REF = 'xvxlhbxtiwxpopoqjygm'

/**
 * `--env-file <path>` or `--env-file=<path>`. Null when absent or empty, which
 * the script turns into a refusal: there is no default file.
 */
export function envFileArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--env-file') {
      const next = argv[i + 1]
      return next && !next.startsWith('--') ? next : null
    }
    if (arg.startsWith('--env-file=')) return arg.slice('--env-file='.length) || null
  }
  return null
}

export type ProductionDecision = { ok: true } | { ok: false; reasons: string[] }

/**
 * Is this environment production by every signal we have? Each must be present
 * and production; a missing one is a refusal, because "could not tell" is how
 * the old script ended up reporting on dev.
 *
 *   NEXT_PUBLIC_APP_ENV        must be `prod` (lib/env.ts appEnv())
 *   STRIPE_SECRET_KEY          must start `sk_live_`
 *   NEXT_PUBLIC_SUPABASE_URL   must name the production project, not the dev
 *                              one (nor a local stack, nor anything else)
 *
 * Reasons name the variable and what was wrong, never the value.
 */
export function productionDecision(env: Record<string, string | undefined>): ProductionDecision {
  const reasons: string[] = []

  const appEnv = (env.NEXT_PUBLIC_APP_ENV ?? '').trim()
  if (appEnv !== 'prod') {
    reasons.push(appEnv ? `NEXT_PUBLIC_APP_ENV is "${appEnv}", not "prod"` : 'NEXT_PUBLIC_APP_ENV is not set')
  }

  const stripe = (env.STRIPE_SECRET_KEY ?? '').trim()
  if (!stripe) {
    reasons.push('STRIPE_SECRET_KEY is not set (vercel env pull leaves Sensitive values empty; add it to the file by hand)')
  } else if (!stripe.startsWith('sk_live_')) {
    reasons.push(stripe.startsWith('sk_test_') ? 'STRIPE_SECRET_KEY is a test key (sk_test_)' : 'STRIPE_SECRET_KEY is not a live key (sk_live_)')
  }

  const supabase = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  if (!supabase) {
    reasons.push('NEXT_PUBLIC_SUPABASE_URL is not set')
  } else if (supabase.includes(DEV_SUPABASE_REF)) {
    reasons.push(`NEXT_PUBLIC_SUPABASE_URL names the dev Supabase project (${DEV_SUPABASE_REF})`)
  } else if (!supabase.includes(PRODUCTION_SUPABASE_REF)) {
    reasons.push(`NEXT_PUBLIC_SUPABASE_URL does not name the production Supabase project (${PRODUCTION_SUPABASE_REF})`)
  }

  return reasons.length ? { ok: false, reasons } : { ok: true }
}

/** The refusal the script prints before exiting 1. */
export function refusalMessage(problem: { envFile: string | null; reasons?: string[] }): string {
  const usage = [
    '',
    '  Usage: npm run verify:prod -- --env-file <path>',
    '',
    '  The file must hold PRODUCTION credentials, for example one written by',
    '    vercel env pull <path> --environment=production',
    '  with the Sensitive values it leaves empty (STRIPE_SECRET_KEY,',
    '  SUPABASE_SECRET_KEY, DOCUSIGN_PRIVATE_KEY) filled in by hand. Keep it',
    '  outside the repo and delete it afterwards. .env.local is never read: it',
    '  holds dev credentials (sk_test_ keys, the dev Supabase project).',
  ]
  if (!problem.envFile) {
    return ['verify:prod: refusing to run — no --env-file given.', ...usage].join('\n')
  }
  return [
    `verify:prod: refusing to run — ${problem.envFile} is not a production environment:`,
    ...(problem.reasons ?? []).map((r) => `  - ${r}`),
    ...usage,
  ].join('\n')
}

/**
 * Same-origin script URLs a page's HTML loads (`<script src="/...">`), resolved
 * against the page. GTM's loader lives in one of these chunks, not in the HTML.
 */
export function sameOriginScriptUrls(html: string, pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin
  const urls = new Set<string>()
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), pageUrl)
      if (url.origin === origin) urls.add(url.href)
    } catch {
      // An unparseable src is not ours to check.
    }
  }
  return [...urls]
}

/**
 * Does this script carry the GTM loader components/analytics/GoogleTagManager
 * renders, for this container?
 *
 * GoogleTagManager is a client component that hands next/script the text of
 * lib/gtm.ts gtmInitScript(id) with strategy lazyOnload, and deliberately
 * renders no <noscript> iframe. next/script injects it in the browser, so the
 * server HTML carries neither the loader nor the container id. What a fetch
 * can see is the client chunk: NEXT_PUBLIC_GTM_ID is inlined at build, and the
 * bundler folds the loader into one string literal, `'dataLayer','GTM-…'` and
 * all. Matching the full loader text (the same text lib/csp.ts hashes) proves
 * both that the component shipped and which container it loads.
 *
 * `loaderText` is gtmInitScript(id); passed in so this stays free of imports.
 * The fallback matches the loader's call site if a bundler ever re-quotes the
 * literal.
 */
export function scriptHasGtmLoader(js: string, gtmId: string, loaderText: string): boolean {
  if (js.includes(loaderText)) return true
  const id = gtmId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    js.includes('googletagmanager.com/gtm.js?id=') &&
    new RegExp(`['"]script['"]\\s*,\\s*['"]dataLayer['"]\\s*,\\s*['"]${id}['"]`).test(js)
  )
}
