'use client'

import { Suspense, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { trackingAllowedHere } from '@/lib/analytics'
import { isHandoffPath, isPrivatePath } from '@/lib/private-routes'
import { CookieConsent } from './CookieConsent'
import { GoogleTagManager } from './GoogleTagManager'
import { HubSpotTracking } from './HubSpotTracking'

/** Drop any analytics event whose URL is a private link, query included. */
function dropPrivate<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url)
    return isPrivatePath(url.pathname, url.search) ? null : event
  } catch {
    return event
  }
}

// The page's query, read in the browser only. The server (and the hydration
// render, which must match it) gets null: "not known yet". Read on every render,
// so a client navigation, which re-renders this through usePathname, sees the
// new query; popstate covers back and forward.
function subscribeToHistory(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  return () => window.removeEventListener('popstate', onChange)
}
const readSearch = () => window.location.search
const searchNotKnown = () => null

/**
 * Whether this page is a private link. A sign-in, sign-up or onboarding page is
 * private when its ?next (or similar) names a private link, so until the query
 * can be read it counts as private: no tag loads on the server render or the
 * hydration pass, and the trackers mount only once the query proves it public.
 */
function usePrivatePage(pathname: string): boolean {
  const search = useSyncExternalStore(subscribeToHistory, readSearch, searchNotKnown)
  if (search === null) return isPrivatePath(pathname) || isHandoffPath(pathname)
  return isPrivatePath(pathname, search)
}

/**
 * Every analytics and advertising tag, plus the cookie banner.
 *
 * A page opened from a private link (a signing link, a pay or join link, a
 * credential, check-in — lib/private-routes.ts) loads none of them: its
 * address is the key to someone's agreement or registration. That used to be
 * decided on the server from a request header set by proxy.ts, which made every
 * page in the app render per request. It is decided here, in the browser, from
 * the same isPrivatePath() list, so public pages can be served from the CDN.
 * A sign-in, sign-up or onboarding page whose query names a private link (a
 * guest sent to sign in from a pay or join link) is private too; it is judged
 * on its query once the browser can read it, and counts as private before.
 *
 * Client-side navigation is covered too: moving from a public page to a
 * private one unmounts the banner and stops Vercel Analytics and Speed Insights
 * reporting the private URL (beforeSend). GTM, once loaded on a public page,
 * stays loaded — as it did before — so links into private pages from public
 * ones should be full page loads (they are emailed or scanned in practice).
 *
 * A host that is not Stellr's own (a tenant host) loads none of them either,
 * decided the same way: in the browser, before any tracker mounts. The server
 * can't tell and sends the Stellr markup, so that branch keeps the two things in
 * it that leave markup behind, or hydration would fail: the banner, which removes
 * itself, and an empty stand-in for SpeedInsights' Suspense boundary.
 */
export function SiteTracking() {
  const pathname = usePathname() ?? ''
  const isPrivate = usePrivatePage(pathname)

  if (!trackingAllowedHere()) {
    return isPrivate ? null : (
      <>
        <CookieConsent disabled />
        <Suspense fallback={null} />
      </>
    )
  }

  return (
    <>
      {!isPrivate && <GoogleTagManager />}
      {!isPrivate && <CookieConsent />}
      {/* Sets the hubspotutk cookie the lead routes pass to the Forms API for
          source attribution (see lib/hubspot.ts). */}
      {!isPrivate && <HubSpotTracking />}
      {!isPrivate && <Analytics beforeSend={dropPrivate} />}
      {/* Real-visitor Core Web Vitals (LCP, INP, CLS) by page and device. No
          cookies. */}
      {!isPrivate && <SpeedInsights beforeSend={dropPrivate} />}
    </>
  )
}
