/**
 * StepUpDownloadLink: same link as before; a click fetches and saves the file
 * under the server's name, and a refusal shows the route's error.
 * (vitest.setup.ts makes useStepUpFetch plain fetch here.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const saveBlob = vi.fn()
vi.mock('@/lib/step-up-download', async (orig) => ({ ...(await orig<typeof import('@/lib/step-up-download')>()), saveBlob: (...a: unknown[]) => saveBlob(...a) }))

import { StepUpDownloadLink } from './step-up'

const fetchMock = vi.fn<(input: string) => Promise<Response>>()
beforeEach(() => {
  saveBlob.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('StepUpDownloadLink', () => {
  it('keeps the href, and a click saves the file under the server’s filename', async () => {
    fetchMock.mockResolvedValueOnce(new Response('a,b', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="members.csv"' } }))
    render(<StepUpDownloadLink href="/api/admin/members/export" className="x">Export CSV</StepUpDownloadLink>)
    const link = screen.getByRole('link', { name: 'Export CSV' })
    expect(link).toHaveAttribute('href', '/api/admin/members/export')
    fireEvent.click(link)
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/members/export', undefined)
    expect(saveBlob.mock.calls[0][1]).toBe('members.csv')
  })

  it('a refused download shows the route’s error and saves nothing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'No mentors at this event yet' }), { status: 400 }))
    render(<StepUpDownloadLink href="/api/admin/events/x/background-reports">Mentor Reports (PDF)</StepUpDownloadLink>)
    fireEvent.click(screen.getByRole('link'))
    expect(await screen.findByRole('alert')).toHaveTextContent('No mentors at this event yet')
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('a modified click is left to the browser', () => {
    render(<StepUpDownloadLink href="/api/admin/members/export">Export CSV</StepUpDownloadLink>)
    fireEvent.click(screen.getByRole('link'), { metaKey: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
