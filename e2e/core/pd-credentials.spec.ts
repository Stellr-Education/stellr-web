import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import type { APIRequestContext } from '@playwright/test'
import { supabaseFetch, supabasePublicKey, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase, isLoopbackSupabase } from '../../lib/testing/e2e-supabase-target'
import { freshClerkSession } from '../fixtures/fresh-session'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * Educator PD credentials (7 Oct 2026): an admin records a teacher's hours at
 * an event; the teacher sees the hours and standards on the credential page
 * and downloads the PD certificate. docs/PLAN-educator-pd-2026-10-07.md.
 *
 * Issued to the seeded teacher Grace on an event with registrations on the dev
 * DB. The route reads title/date/venue from Sanity and falls back to the
 * registrations' title when Sanity has none — CI has no Sanity credentials
 * (the first CI run failed "Event not found", 7 Oct). Her PD rows are deleted before and
 * after each test with the service role — in a hook, so a failure part-way
 * cannot leave a live PD credential blocking the next run (see the 24 Sept
 * note in credentials.spec.ts).
 */

const SLUG = 'nevada-space-design-challenge'
const GRACE_ID = '00000000-0000-4000-a000-000000000002' // supabase/seed.sql

async function removeGracePd() {
  const url = assertE2eSupabase()
  const db = createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
  const { error } = await db.from('credentials').delete().eq('source', 'pd').eq('member_id', GRACE_ID)
  expect(error, `removing Grace's PD credentials: ${error?.message}`).toBeNull()
}

test.describe('educator PD credential', () => {
  test.beforeEach(removeGracePd)
  test.afterEach(removeGracePd)

  test('an admin issues hours once; the teacher sees them and downloads the certificate', async ({ browser }) => {
    const admin = await browser.newContext({ storageState: storageStatePath('admin') })
    // A page that loads Clerk, kept open, and a token minted on it before the API
    // calls. Loading the page alone kept a saved token with seconds left, which
    // expired before the call: 401s in CI, 12 Nov 2026 (fixtures/fresh-session.ts).
    const adminPage = await admin.newPage()
    await adminPage.goto('/account')
    await freshClerkSession(adminPage)
    const issue = (hours: number) =>
      admin.request.post(`/api/admin/events/${SLUG}/pd-credentials`, { data: { memberId: GRACE_ID, hours } })

    const first = await issue(7.5)
    expect(first.status(), await first.text()).toBe(200)
    const { created, credential } = await first.json()
    expect(created).toBe(true)
    expect(credential.title).toMatch(/^Professional Development — .+ \(7\.5 hours\)$/)
    expect(credential.standards.length).toBeGreaterThan(0)

    // Idempotent: a second issue returns the live one, hours unchanged.
    const again = await (await issue(4)).json()
    expect(again.created).toBe(false)
    expect(again.credential.number).toBe(credential.number)
    expect(Number(again.credential.pd_hours)).toBe(7.5)

    // The participation panel's list does not pick PD rows up.
    const participation = await (await admin.request.get(`/api/admin/events/${SLUG}/credentials`)).json()
    expect(participation.credentials.some((c: { source: string }) => c.source === 'pd')).toBe(false)

    const teacher = await browser.newContext({ storageState: storageStatePath('teacher') })
    // The teacher's API calls get the same treatment, from her own account page.
    const teacherAccount = await teacher.newPage()
    await teacherAccount.goto('/account')
    const page = await teacher.newPage()
    await page.goto(`/credentials/${credential.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('(7.5 hours)')
    await expect(page.getByText('7.5 PD hours')).toBeVisible()
    await expect(page.getByText('Aligned to')).toBeVisible()

    // Owner download; PD is never held behind the survey.
    await freshClerkSession(teacherAccount)
    const pdf = await page.request.get(`/api/credentials/${credential.number}/pdf`)
    expect(pdf.status()).toBe(200)
    expect(pdf.headers()['content-type']).toBe('application/pdf')

    // Only admins record hours: the teacher (not an event manager) is refused.
    const refused = await teacher.request.post(`/api/admin/events/${SLUG}/pd-credentials`, { data: { memberId: GRACE_ID, hours: 2 } })
    expect(refused.status()).toBe(403)

    await admin.close()
    await teacher.close()
  })
})

/**
 * The PD certificate's artwork (educator-pd.16): an event's own front page,
 * uploaded and positioned, standing in for the Space default until it is
 * removed; and the positioner previewing the Space default on Competitions →
 * Default artwork.
 *
 * The event's upload, positions and removal go through the API the panel calls
 * (components/admin/PdCertificateArtwork.tsx). Its event-scoped copy sits on the
 * event's Settings tab, at /admin/competitions/[slug], which reads the event
 * from Sanity and answers 404 without it, and CI runs this suite with
 * NEXT_PUBLIC_SANITY_PROJECT_ID unset. The defaults page has no such
 * dependency, so the positioner is opened there, and only looked at: saving
 * would move the Space default every Space event prints on.
 *
 * The event is a throwaway slug whose files (pd-certificate/events/<slug>/ in
 * the community-resources bucket) are removed in a hook, whether or not the
 * test passed. The Space default's pages and layout are only read.
 */

const PD_BUCKET = 'community-resources'

interface PdStatus {
  theme: string
  pages: { front: string | null; back: string | null; layout: string | null }
  layout: Record<'name' | 'location' | 'date' | 'hours', { x: number; y: number; maxWidth: number; size: number }>
  defaults: { front: string | null; back: string | null; layout: string | null } | null
}

async function pdStatus(request: APIRequestContext, query: string): Promise<PdStatus> {
  const res = await request.get(`/api/admin/pd-certificate?${query}`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as PdStatus
}

async function removeEventPdFiles(slug: string) {
  if (!slug.startsWith('e2e-pd-art-')) throw new Error(`refusing to clean up ${slug}`)
  const bucket = createClient(assertE2eSupabase(), supabaseSecretKey() as string, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetch },
  }).storage.from(PD_BUCKET)
  const folder = `pd-certificate/events/${slug}`
  const { data: files } = await bucket.list(folder)
  if (files?.length) {
    const { error } = await bucket.remove(files.map((f) => `${folder}/${f.name}`))
    expect(error, `removing ${folder}: ${error?.message}`).toBeNull()
  }
}

test.describe('PD certificate artwork', () => {
  test.use({ storageState: storageStatePath('admin') })

  let slug = ''
  test.beforeEach(() => {
    slug = `e2e-pd-art-${randomBytes(4).toString('hex')}`
  })
  test.afterEach(async () => {
    if (slug) await removeEventPdFiles(slug)
  })

  test('an event uploads its own front, positions the fields, previews it, and goes back to the Space default', async ({ page, baseURL }) => {
    await page.goto('/admin/competitions/artwork')
    expect(new URL(page.url()).origin, 'the defaults page was served from another host').toBe(new URL(baseURL!).origin)
    await freshClerkSession(page)
    const scope = `theme=space&event=${slug}`

    // Nothing of its own: every page and the layout are the Space default's.
    const space = await pdStatus(page.request, 'theme=space')
    const before = await pdStatus(page.request, scope)
    expect(before.pages).toEqual({ front: null, back: null, layout: null })
    expect(before.defaults).toEqual(space.pages)
    expect(before.layout).toEqual(space.layout)

    // Upload: the bytes go to storage on a signed URL, then the staged path is
    // posted, as uploadDirectToStorage and the panel do.
    const png = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#f4f1ea' } }).png().toBuffer()
    const sign = await page.request.post('/api/uploads/sign', {
      data: { purpose: 'pd-certificate-artwork', fileName: 'e2e-pd-front.png', fileSize: png.length, contentType: 'image/png' },
    })
    expect(sign.status(), await sign.text()).toBe(200)
    const ticket = (await sign.json()) as { bucket: string; path: string; token: string }
    expect(ticket.bucket).toBe(PD_BUCKET)
    const { error: putError } = await createClient(assertE2eSupabase(), supabasePublicKey() as string, {
      auth: { persistSession: false },
      global: { fetch: supabaseFetch },
    })
      .storage.from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, png, { contentType: 'image/png', upsert: true })
    expect(putError, `storage refused the upload: ${putError?.message}`).toBeNull()

    const saved = await page.request.put('/api/admin/pd-certificate', {
      data: { theme: 'space', event: slug, page: 'front', storagePath: ticket.path },
    })
    expect(saved.status(), await saved.text()).toBe(200)
    const uploaded = await pdStatus(page.request, scope)
    expect(uploaded.pages.front).not.toBeNull()
    expect(uploaded.pages.back).toBeNull()

    // Position the fields: move the name and the hours, then save.
    const moved = {
      ...uploaded.layout,
      name: { ...uploaded.layout.name, y: 0.41, size: 48 },
      hours: { ...uploaded.layout.hours, x: 0.5 },
    }
    const positioned = await page.request.put('/api/admin/pd-certificate', { data: { theme: 'space', event: slug, layout: moved } })
    expect(positioned.status(), await positioned.text()).toBe(200)
    const after = await pdStatus(page.request, scope)
    expect(after.layout).toEqual(moved)
    expect(after.pages.layout).not.toBeNull()
    // The Space default's positions did not move.
    expect((await pdStatus(page.request, 'theme=space')).layout).toEqual(space.layout)

    // The positioner's preview renders on the event's own front.
    const preview = await page.request.get(
      `/api/admin/pd-certificate/preview?${new URLSearchParams({ theme: 'space', event: slug, name: 'Grace Teacher', layout: JSON.stringify(moved) })}`,
    )
    expect(preview.status(), await preview.text()).toBe(200)
    expect(preview.headers()['content-type']).toBe('application/pdf')

    // "Use the default": the front goes, and its layout with it.
    const removed = await page.request.delete(`/api/admin/pd-certificate?${scope}&page=front`)
    expect(removed.status(), await removed.text()).toBe(200)
    const back = await pdStatus(page.request, scope)
    expect(back.pages).toEqual({ front: null, back: null, layout: null })
    expect(back.layout).toEqual(space.layout)
  })

  test('the positioner previews the Space default on Competitions → Default artwork', async ({ page, baseURL }) => {
    await page.goto('/admin/competitions/artwork')
    expect(new URL(page.url()).origin, 'the defaults page was served from another host').toBe(new URL(baseURL!).origin)
    await freshClerkSession(page)
    const space = await pdStatus(page.request, 'theme=space')
    // The disposable e2e stack stores no artwork (docs/RUNBOOK-ci-database.md,
    // "What it does not test"); the shared dev database holds the Space set.
    test.skip(!space.pages.front && isLoopbackSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL), 'the e2e stack has no Space PD front')
    expect(space.pages.front, 'dev has no Space default PD front').not.toBeNull()

    const main = page.getByRole('main')
    const front = main.getByRole('listitem').filter({ hasText: 'Front (the fields are drawn on this)' })
    const previewed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/pd-certificate/preview')
    await front.getByRole('button', { name: 'Position the fields' }).click()

    // The preview is asked for with the saved positions, and renders.
    const response = await previewed
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/pdf')
    const asked = new URL(response.url()).searchParams
    expect(asked.get('theme')).toBe('space')
    expect(asked.get('event')).toBeNull()
    expect(JSON.parse(asked.get('layout')!)).toEqual(space.layout)

    // One field at a time.
    const fields = main.getByRole('tablist', { name: 'Field to position' })
    await expect(fields.getByRole('tab', { name: 'Teacher name' })).toHaveAttribute('aria-selected', 'true')
    await fields.getByRole('tab', { name: 'Hours of effort' }).click()
    await expect(fields.getByRole('tab', { name: 'Hours of effort' })).toHaveAttribute('aria-selected', 'true')
    await expect(main.getByRole('button', { name: 'Save positions' })).toBeVisible()

    // Closed without saving: the Space default is as it was.
    await front.getByRole('button', { name: 'Close' }).click()
    await expect(fields).toHaveCount(0)
    expect((await pdStatus(page.request, 'theme=space')).layout).toEqual(space.layout)
  })
})
