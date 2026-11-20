// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 wave 8, K11 canary probe P4: Stellr's pages read an event by slug from the CMS,
// which holds every tenant's documents. requireStellrEvent asks the events mirror whose
// event it is, by C20c's rule (loadEventTenantId): an unmirrored slug is Stellr's, another
// tenant's is the normal not-found, and a failed read is never Stellr's.

const OTHER_TENANT = '00000000-0000-4000-8000-0000000000aa'

const db = vi.hoisted(() => ({
  row: null as { tenant_id: string | null } | null,
  error: null as { message: string } | null,
  reads: [] as string[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            db.reads.push(`${table}.${column}=${value}`)
            return { data: db.row, error: db.error }
          },
        }),
      }),
    }),
  }),
}))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({ notFound }))

const { requireStellrEvent, isStellrEvent, EventOwnerUnavailableError } = await import('./stellr-owner')

beforeEach(() => {
  db.row = null
  db.error = null
  db.reads = []
  notFound.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('requireStellrEvent', () => {
  it("lets Stellr's own event through, with one owner read by slug", async () => {
    db.row = { tenant_id: STELLR_TENANT_ID }
    await expect(requireStellrEvent('nv-2027')).resolves.toBeUndefined()
    expect(db.reads).toEqual(['events.slug=nv-2027'])
    expect(notFound).not.toHaveBeenCalled()
  })

  it("counts an unmirrored slug, or a NULL tenant_id, as Stellr's", async () => {
    db.row = null
    await expect(requireStellrEvent('new-event')).resolves.toBeUndefined()
    db.row = { tenant_id: null }
    await expect(requireStellrEvent('backfill-pending')).resolves.toBeUndefined()
    expect(notFound).not.toHaveBeenCalled()
  })

  it("answers another tenant's event with the normal not-found", async () => {
    db.row = { tenant_id: OTHER_TENANT }
    await expect(requireStellrEvent('dev-canary-event')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('throws a retryable error when the owner read fails, never a 404 and never Stellr', async () => {
    db.error = { message: 'connection reset' }
    const err = await requireStellrEvent('nv-2027').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EventOwnerUnavailableError)
    expect(notFound).not.toHaveBeenCalled()
    await expect(isStellrEvent('nv-2027')).rejects.toBeInstanceOf(EventOwnerUnavailableError)
  })
})
