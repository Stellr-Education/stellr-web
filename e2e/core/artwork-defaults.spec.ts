import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import type { APIRequestContext, Page } from '@playwright/test'
import { supabaseFetch, supabasePublicKey, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase, isLoopbackSupabase } from '../../lib/testing/e2e-supabase-target'
import { attachConsoleGuard } from '../fixtures/console-guard'
import { freshClerkSession } from '../fixtures/fresh-session'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * Default artwork (30 Oct 2026): every event prints its theme's badges,
 * certificates and PD pages until it uploads its own. Closes tracker row
 * artwork-defaults.10.
 *
 * Two tests:
 *   1. Competitions → Default artwork renders for an admin, and each panel says
 *      what the API says every Space event prints.
 *   2. A Space event with no artwork of its own falls back to the Space default
 *      badge, takes its own upload, and goes back to the default when that is
 *      removed: the "Use the default" round trip.
 *
 * Test 2 drives the event-scoped API the Settings tab's badge panel reads
 * (components/admin/EventBadges.tsx), not the tab itself. The tab lives on
 * /admin/competitions/[slug], which reads the event from Sanity and answers 404
 * without it, and CI runs this suite with NEXT_PUBLIC_SANITY_PROJECT_ID unset.
 * The panel prints "Uses the Space default." for a slot exactly when the GET
 * returns no template of the event's own for it and a Space default in
 * `defaults`, which is what the test asserts.
 *
 * The event is a throwaway slug, so no real event's artwork is touched, and the
 * Space defaults are only read: they are shared by every Space event on dev.
 * Its rows and storage objects are removed in a hook, whether or not the test
 * passed.
 */

test.use({ storageState: storageStatePath('admin') })

const SPACE_DEFAULTS = '/api/admin/artwork-defaults/space/badge-templates'
const FORMAT = 'avery_5392' // the panel's first Avery product (DEFAULT_BADGE_FORMAT)
const FORMAT_KIND = 'badge' // BADGE_FORMATS.avery_5392.artworkKind

interface BadgeTemplate {
  id: string
  format: string
  audience: string
  company_id: string | null
}

function db(): SupabaseClient {
  return createClient(assertE2eSupabase(), supabaseSecretKey() as string, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetch },
  })
}

async function removeEventArtwork(slug: string) {
  if (!slug.startsWith('e2e-artwork-')) throw new Error(`refusing to clean up ${slug}`)
  const client = db()
  const { error } = await client.from('event_badge_templates').delete().eq('event_slug', slug)
  expect(error, `removing ${slug}'s badge templates: ${error?.message}`).toBeNull()
  const bucket = client.storage.from('community-resources')
  const { data: files } = await bucket.list(`event-artwork/${slug}`)
  if (files?.length) {
    const { error: rmError } = await bucket.remove(files.map((f) => `event-artwork/${slug}/${f.name}`))
    expect(rmError, `removing ${slug}'s artwork files: ${rmError?.message}`).toBeNull()
  }
}

/** Open the defaults page (it loads Clerk) and check it is this run's server, not another host. */
async function openDefaults(page: Page, baseURL: string | undefined) {
  await page.goto('/admin/competitions/artwork')
  expect(new URL(page.url()).origin, 'the defaults page was served from another host').toBe(new URL(baseURL!).origin)
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Default artwork' })).toBeVisible()
}

async function json<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url)
  expect(res.status(), `${url}: ${await res.text()}`).toBe(200)
  return (await res.json()) as T
}

test('the defaults page renders for an admin, each panel saying what every Space event prints', async ({ page, baseURL }) => {
  const consoleErrors = attachConsoleGuard(page)
  await openDefaults(page, baseURL)
  const main = page.getByRole('main')

  const themes = main.getByRole('navigation', { name: 'Competition theme' })
  await expect(themes.getByRole('link', { name: 'Space events' })).toHaveAttribute('aria-current', 'page')
  await expect(themes.getByRole('link', { name: 'Environmental events' })).not.toHaveAttribute('aria-current', 'page')

  // What the panels load, read the same way they read it.
  await freshClerkSession(page)
  const badges = await json<{ templates: BadgeTemplate[] }>(page.request, SPACE_DEFAULTS)
  const certificates = await json<{ templates: Record<string, unknown | null> }>(
    page.request,
    '/api/admin/artwork-defaults/space/certificate-templates',
  )
  const pd = await json<{ pages: { front: string | null; back: string | null } }>(page.request, '/api/admin/pd-certificate?theme=space')

  // Name badges: the Everyone row on the first Avery product.
  await expect(main.getByRole('heading', { name: 'Name badges' })).toBeVisible()
  await expect(main.getByRole('radio', { name: /5392/ })).toHaveAttribute('aria-checked', 'true')
  const everyone = main.getByRole('listitem').filter({ hasText: 'Every badge without its own background below.' })
  const hasEveryone = badges.templates.some((t) => t.format === FORMAT && t.audience === 'everyone')
  await expect(everyone).toContainText(hasEveryone ? 'Background set.' : 'Plain badges (name, role, event).')

  // Certificates: one row per award, "Artwork set." for each the API holds.
  await expect(main.getByRole('heading', { name: 'Certificates' })).toBeVisible()
  const set = Object.values(certificates.templates).filter(Boolean).length
  await expect(main.getByText('Artwork set.', { exact: true })).toHaveCount(set)
  await expect(main.getByText('No artwork yet.', { exact: true })).toHaveCount(Object.keys(certificates.templates).length - set)

  // The educator PD certificate's two pages.
  await expect(main.getByRole('heading', { name: 'Educator PD certificate' })).toBeVisible()
  const front = main.getByRole('listitem').filter({ hasText: 'Front (the fields are drawn on this)' })
  if (pd.pages.front) await expect(front).not.toContainText('not uploaded')
  await expect(front).toContainText(pd.pages.front ? 'uploaded' : 'not uploaded')

  // Nothing failed to load.
  await expect(main.getByText(/^Could not load/)).toHaveCount(0)
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
})

test.describe('an event without its own badge background', () => {
  let slug = ''
  test.beforeEach(() => {
    slug = `e2e-artwork-${randomBytes(4).toString('hex')}`
  })
  test.afterEach(async () => {
    if (slug) await removeEventArtwork(slug)
  })

  test('uses the Space default, takes its own upload, and goes back to the default when it is removed', async ({ page, baseURL }) => {
    await openDefaults(page, baseURL)
    await freshClerkSession(page)
    const eventTemplates = `/api/admin/events/${slug}/badge-templates`

    const spaceDefault = (await json<{ templates: BadgeTemplate[] }>(page.request, SPACE_DEFAULTS)).templates.find(
      (t) => t.format === FORMAT && t.audience === 'everyone',
    )
    // The disposable e2e stack stores no artwork (docs/RUNBOOK-ci-database.md,
    // "What it does not test"); the shared dev database holds the Space set.
    test.skip(!spaceDefault && isLoopbackSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL), 'the e2e stack has no Space default badge')
    expect(spaceDefault, 'dev has no Space default Everyone badge for Avery 5392').toBeTruthy()

    // 1. Nothing of its own: the Everyone slot falls back to the Space default.
    //    This is the state the Settings tab shows as "Uses the Space default."
    const before = await json<{ theme: string; templates: BadgeTemplate[]; defaults: BadgeTemplate[] }>(page.request, eventTemplates)
    expect(before.theme).toBe('space')
    expect(before.templates).toEqual([])
    expect(before.defaults.map((t) => t.id)).toContain(spaceDefault!.id)

    // 2. "Upload this event's own": the bytes go to storage on a signed URL,
    //    then the path is posted, as uploadDirectToStorage does.
    const png = await sharp({ create: { width: 900, height: 675, channels: 3, background: '#e8eefc' } }).png().toBuffer()
    const sign = await page.request.post('/api/uploads/sign', {
      data: {
        purpose: 'event-artwork',
        context: { slug, kind: FORMAT_KIND },
        fileName: 'e2e-badge.png',
        fileSize: png.length,
        contentType: 'image/png',
      },
    })
    expect(sign.status(), await sign.text()).toBe(200)
    const ticket = (await sign.json()) as { bucket: string; path: string; token: string }
    expect(ticket.path.startsWith(`event-artwork/${slug}/`)).toBe(true)
    const storage = createClient(assertE2eSupabase(), supabasePublicKey() as string, {
      auth: { persistSession: false },
      global: { fetch: supabaseFetch },
    }).storage
    const { error: putError } = await storage
      .from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, png, { contentType: 'image/png', upsert: true })
    expect(putError, `storage refused the upload: ${putError?.message}`).toBeNull()

    const saved = await page.request.put(eventTemplates, {
      data: { format: FORMAT, audience: 'everyone', companyId: null, storagePath: ticket.path, fileType: 'image/png' },
    })
    expect(saved.status(), await saved.text()).toBe(200)
    const own = ((await saved.json()) as { template: BadgeTemplate }).template
    expect(own.id).not.toBe(spaceDefault!.id)

    // Its own background now stands in for the default, which is still there.
    const during = await json<{ templates: BadgeTemplate[]; defaults: BadgeTemplate[] }>(page.request, eventTemplates)
    expect(during.templates.map((t) => [t.id, t.format, t.audience, t.company_id])).toEqual([[own.id, FORMAT, 'everyone', null]])
    expect(during.defaults.map((t) => t.id)).toContain(spaceDefault!.id)

    // 3. "Use the default": remove its own, and the Space default is back.
    const removed = await page.request.delete(`${eventTemplates}?id=${own.id}`)
    expect(removed.status(), await removed.text()).toBe(200)
    const after = await json<{ templates: BadgeTemplate[]; defaults: BadgeTemplate[] }>(page.request, eventTemplates)
    expect(after.templates).toEqual([])
    expect(after.defaults.map((t) => t.id)).toContain(spaceDefault!.id)

    // The Space default itself was never touched.
    const still = (await json<{ templates: BadgeTemplate[] }>(page.request, SPACE_DEFAULTS)).templates.map((t) => t.id)
    expect(still).toContain(spaceDefault!.id)
  })
})
