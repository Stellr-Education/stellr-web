/**
 * Browser-side helpers for the F4 step-up (lib/authz/step-up.ts). Pure, so
 * they test without Clerk; components/admin/step-up.tsx wires them to
 * useReverification.
 */

/** Clerk's reverification hint, as reverificationErrorResponse writes it. Mirrors @clerk/shared's isReverificationHint. */
export function isReverificationHint(body: unknown): boolean {
  if (!body || typeof body !== 'object' || !('clerk_error' in body)) return false
  const e = (body as { clerk_error?: { type?: unknown; reason?: unknown } }).clerk_error
  return e?.type === 'forbidden' && e?.reason === 'reverification-error'
}

/** The filename in a Content-Disposition header, or null. Handles filename*=UTF-8'' and quoted filename=. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/.exec(header) ?? /filename\s*=\s*([^;]+)/.exec(header)
  const name = plain?.[1]?.trim()
  return name ? name : null
}

/** The last path segment of a URL, for a download with no Content-Disposition. */
export function fallbackFilename(href: string): string {
  const path = href.split('?')[0] ?? ''
  return path.split('/').filter(Boolean).pop() || 'download'
}

/** The error a failed download shows: the route's own { error }, or a plain line. */
export async function downloadErrorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' && body.error ? body.error : `The download didn’t work (${res.status}). Try again.`
}

/** Hand a fetched file to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
