'use client'

/**
 * StepUpDownloadLink replaces a plain <a href> download of an F4 step-up route
 * (lib/authz/step-up.ts). It keeps the link, so a new-tab or copied link still
 * works, but a normal click fetches the file through useStepUpFetch (Clerk's
 * re-verification dialog and a retry when the server asks for one) and saves it
 * under the server's filename.
 */
import { useState, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { useStepUpFetch } from '@/components/admin/use-step-up-fetch'
import { downloadErrorText, fallbackFilename, filenameFromDisposition, saveBlob } from '@/lib/step-up-download'

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & { href: string }

/** A download link for a step-up route. Same markup as the <a href> it replaces. */
export function StepUpDownloadLink({ href, children, ...rest }: Props) {
  const stepUpFetch = useStepUpFetch()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // A modified or middle click keeps the browser's own handling (new tab, save link).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await stepUpFetch(href)
      if (!res.ok) {
        setError(await downloadErrorText(res))
        return
      }
      saveBlob(await res.blob(), filenameFromDisposition(res.headers.get('Content-Disposition')) ?? fallbackFilename(href))
    } catch {
      setError('Couldn’t reach Stellr. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <a href={href} onClick={onClick} aria-busy={busy || undefined} {...rest}>
        {children}
      </a>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
  )
}
