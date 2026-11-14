// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 C20a: training is Stellr-only in release 1, so a new module carries Stellr's
// tenant_id itself. An academy module names no event, so the S3 trigger would log
// `no_key` for it, and derivation enforce would refuse it. A module tied to an event
// must be tied to one of Stellr's: the route asks refuseUnlessStellrEvent (C20c) once,
// before any write. In log mode the trigger keeps a supplied tenant_id that agrees with
// the derived one, so Stellr's modules get the value they get today.

const OTHER_TENANT = '00000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  stellrAdmin: true,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  eventReads: [] as unknown[],
  eventOwner: null as string | null,
  eventError: null as { message: string } | null,
  ensureTrainingContainer: vi.fn(async () => {}),
}))

function from(table: string) {
  const q: Record<string, unknown> = {}
  q.insert = (row: Record<string, unknown>) => {
    h.inserts.push({ table, row })
    return q
  }
  q.select = () => q
  q.eq = (_c: string, v: unknown) => {
    if (table === 'events') h.eventReads.push(v)
    return q
  }
  q.single = async () => ({ data: { id: 'module-1' }, error: null })
  q.maybeSingle = async () => {
    if (table !== 'events') return { data: null, error: null }
    if (h.eventError) return { data: null, error: h.eventError }
    return { data: h.eventOwner ? { tenant_id: h.eventOwner } : null, error: null }
  }
  return q
}

vi.mock('@/lib/authz', () => ({ isStellrAdmin: async () => h.stellrAdmin, hasCapability: async () => h.stellrAdmin }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, fn: unknown) => fn }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/community', () => ({ getSignedInMember: async () => ({ id: 'member-admin' }) }))
vi.mock('@/lib/container-sync', () => ({ ensureTrainingContainer: h.ensureTrainingContainer }))

import { POST } from './route'

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/admin/community/training/modules', { method: 'POST', body: JSON.stringify(body) }))
const moduleInsert = () => h.inserts.find((i) => i.table === 'training_modules')

beforeEach(() => {
  h.stellrAdmin = true
  h.inserts = []
  h.eventReads = []
  h.eventOwner = null
  h.eventError = null
  h.ensureTrainingContainer.mockClear()
})

describe('POST /api/admin/community/training/modules: explicit tenant_id (S5 C20a)', () => {
  it("writes an event-less module with Stellr's tenant_id, reads no event, and answers as before", async () => {
    const res = await post({ title: 'Orbital mechanics' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'module-1' })
    expect(moduleInsert()?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, title: 'Orbital mechanics', event_ref: null, created_by: 'member-admin' })
    expect(h.eventReads).toEqual([])
  })

  it("writes a module tied to Stellr's event with Stellr's tenant_id, after one events read", async () => {
    h.eventOwner = STELLR_TENANT_ID
    const res = await post({ title: 'Briefing', eventRef: 'stellr-comp' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'module-1' })
    expect(h.eventReads).toEqual(['stellr-comp'])
    expect(moduleInsert()?.row).toMatchObject({ tenant_id: STELLR_TENANT_ID, event_ref: 'stellr-comp' })
  })

  it("treats an event the mirror does not know as Stellr's", async () => {
    const res = await post({ title: 'Briefing', eventRef: 'not-mirrored' })
    expect(res.status).toBe(200)
    expect(moduleInsert()?.row.tenant_id).toBe(STELLR_TENANT_ID)
  })

  it("refuses a module tied to another tenant's event with C20c's 404, before any write", async () => {
    h.eventOwner = OTHER_TENANT
    const res = await post({ title: 'Briefing', eventRef: 'tenant-comp' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(h.inserts).toEqual([])
    expect(h.ensureTrainingContainer).not.toHaveBeenCalled()
  })

  it('answers a failed owner read with a retryable 503, and writes nothing', async () => {
    h.eventError = { message: 'boom' }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ title: 'Briefing', eventRef: 'stellr-comp' })
    err.mockRestore()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(h.inserts).toEqual([])
  })

  it('takes no tenant_id from the request body', async () => {
    await post({ title: 'Briefing', tenant_id: OTHER_TENANT })
    expect(moduleInsert()?.row.tenant_id).toBe(STELLR_TENANT_ID)
  })

  it('still asks for a title, and refuses a non-admin, before reading the event', async () => {
    expect((await post({ eventRef: 'stellr-comp' })).status).toBe(400)
    h.stellrAdmin = false
    expect((await post({ title: 'x', eventRef: 'stellr-comp' })).status).toBe(403)
    expect(h.eventReads).toEqual([])
    expect(h.inserts).toEqual([])
  })
})
