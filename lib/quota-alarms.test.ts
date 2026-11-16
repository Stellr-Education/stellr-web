// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ lastResult: vi.fn(), notify: vi.fn() }))
vi.mock('@/lib/cron-runs', () => ({ lastCronResult: h.lastResult }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: h.notify }))

import {
  DATABASE_ALARM_BYTES,
  PLAN_DATABASE_LIMIT_BYTES,
  PLAN_STORAGE_LIMIT_BYTES,
  STORAGE_ALARM_BYTES,
  checkQuotaUsage,
  evaluateQuota,
  isFunctionMissing,
  quotaAlert,
} from './quota-alarms'

const MB = 1024 * 1024
const NOW = new Date('2026-11-15T05:00:00Z')

function dbReturning(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { db: { rpc } as unknown as SupabaseClient, rpc }
}

const usageRow = (databaseMb: number, storageMb: number) => ({
  data: [{ database_bytes: databaseMb * MB, storage_bytes: storageMb * MB }],
  error: null,
})

beforeEach(() => {
  h.lastResult.mockReset().mockResolvedValue(null)
  h.notify.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('thresholds', () => {
  it('are 60% of the plan limits: 300 MB of 500 MB, 600 MB of 1 GB', () => {
    expect(PLAN_DATABASE_LIMIT_BYTES).toBe(500 * MB)
    expect(PLAN_STORAGE_LIMIT_BYTES).toBe(1024 * MB)
    expect(DATABASE_ALARM_BYTES).toBe(300 * MB)
    expect(DATABASE_ALARM_BYTES / PLAN_DATABASE_LIMIT_BYTES).toBe(0.6)
    expect(STORAGE_ALARM_BYTES).toBe(600 * MB)
    expect(STORAGE_ALARM_BYTES / PLAN_STORAGE_LIMIT_BYTES).toBeLessThanOrEqual(0.6)
    expect(STORAGE_ALARM_BYTES / PLAN_STORAGE_LIMIT_BYTES).toBeGreaterThan(0.58)
  })

  it('fire at the alarm exactly, not a byte before', () => {
    expect(evaluateQuota({ databaseBytes: DATABASE_ALARM_BYTES - 1, storageBytes: 0 }).over).toBe(false)
    expect(evaluateQuota({ databaseBytes: DATABASE_ALARM_BYTES, storageBytes: 0 }).database.over).toBe(true)
    expect(evaluateQuota({ databaseBytes: 0, storageBytes: STORAGE_ALARM_BYTES - 1 }).over).toBe(false)
    expect(evaluateQuota({ databaseBytes: 0, storageBytes: STORAGE_ALARM_BYTES }).storage.over).toBe(true)
  })

  it('report each measure on its own, with its percent of the plan limit', () => {
    const e = evaluateQuota({ databaseBytes: 250 * MB, storageBytes: 700 * MB })
    expect(e.database).toEqual({
      bytes: 250 * MB,
      limitBytes: 500 * MB,
      alarmBytes: 300 * MB,
      percent: 50,
      over: false,
    })
    expect(e.storage.over).toBe(true)
    expect(e.storage.percent).toBe(68.4)
    expect(e.over).toBe(true)
  })
})

describe('quotaAlert', () => {
  it('names only the measures past the alarm, in numbers', () => {
    const alert = quotaAlert(evaluateQuota({ databaseBytes: 320 * MB, storageBytes: 10 * MB }))
    expect(alert.type).toBe('action')
    expect(alert.body).toContain('The database is at 320 MB of 500 MB (64%), past the alarm at 300 MB.')
    expect(alert.body).not.toContain('File storage')
    expect(alert.email?.subject).toBe('Supabase database past 60% of the plan')
  })

  it('covers both in one alert when both are over', () => {
    const alert = quotaAlert(evaluateQuota({ databaseBytes: 400 * MB, storageBytes: 800 * MB }))
    expect(alert.body).toContain('The database is at 400 MB')
    expect(alert.body).toContain('File storage is at 800 MB of 1024 MB')
    expect(alert.email?.subject).toBe('Supabase database and storage past 60% of the plan')
  })
})

describe('isFunctionMissing', () => {
  it('is true for PostgREST PGRST202 and Postgres 42883 only', () => {
    expect(isFunctionMissing({ code: 'PGRST202' })).toBe(true)
    expect(isFunctionMissing({ code: '42883' })).toBe(true)
    expect(isFunctionMissing({ code: '42501' })).toBe(false)
    expect(isFunctionMissing(null)).toBe(false)
  })
})

describe('checkQuotaUsage', () => {
  it('skips without failing when the function is not applied yet (PGRST202)', async () => {
    const { db, rpc } = dbReturning({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    await expect(checkQuotaUsage(db, { now: NOW })).resolves.toEqual({ skipped: 'function_missing' })
    expect(rpc).toHaveBeenCalledWith('platform_quota_usage')
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('skips without failing on Postgres undefined_function (42883)', async () => {
    const { db } = dbReturning({ data: null, error: { code: '42883', message: 'function does not exist' } })
    await expect(checkQuotaUsage(db, { now: NOW })).resolves.toEqual({ skipped: 'function_missing' })
  })

  it('throws on any other read error, for the caller to record', async () => {
    const { db } = dbReturning({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(checkQuotaUsage(db, { now: NOW })).rejects.toThrow(/42501/)
  })

  it('throws when no usable row comes back', async () => {
    const { db } = dbReturning({ data: [], error: null })
    await expect(checkQuotaUsage(db, { now: NOW })).rejects.toThrow(/no usable row/)
  })

  it('under both alarms: records the numbers and sends nothing', async () => {
    const { db } = dbReturning(usageRow(100, 200))
    const out = await checkQuotaUsage(db, { now: NOW })
    expect(out).toEqual({
      databaseBytes: 100 * MB,
      storageBytes: 200 * MB,
      databasePercent: 20,
      storagePercent: 19.5,
      over: [],
      alerted: false,
    })
    expect(h.notify).not.toHaveBeenCalled()
    expect(h.lastResult).not.toHaveBeenCalled()
  })

  it('over an alarm: sends exactly one alert, even with both over, and records the day', async () => {
    const { db } = dbReturning(usageRow(350, 700))
    const out = await checkQuotaUsage(db, { now: NOW })
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify.mock.calls[0][0].body).toContain('The database is at 350 MB')
    expect(out).toMatchObject({ over: ['database', 'storage'], alerted: true, alertedOn: '2026-11-15' })
    expect(h.lastResult).toHaveBeenCalledWith(db, 'entitlements')
  })

  it('accepts a single-object row as well as an array', async () => {
    const { db } = dbReturning({ data: { database_bytes: String(310 * MB), storage_bytes: '0' }, error: null })
    await expect(checkQuotaUsage(db, { now: NOW })).resolves.toMatchObject({ databaseBytes: 310 * MB, alerted: true })
  })

  it('a second run the same day stays quiet and carries the day forward', async () => {
    h.lastResult.mockResolvedValue({ granted: 0, quota: { alerted: true, alertedOn: '2026-11-15' } })
    const { db } = dbReturning(usageRow(350, 0))
    const out = await checkQuotaUsage(db, { now: NOW })
    expect(h.notify).not.toHaveBeenCalled()
    expect(out).toMatchObject({ alerted: false, alertedOn: '2026-11-15', alertSkipped: 'already_alerted_today' })
  })

  it('alerts again on the next day', async () => {
    h.lastResult.mockResolvedValue({ quota: { alerted: true, alertedOn: '2026-11-14' } })
    const { db } = dbReturning(usageRow(350, 0))
    const out = await checkQuotaUsage(db, { now: NOW })
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ alerted: true, alertedOn: '2026-11-15' })
  })

  it('reports an alert that could not be sent, without a day, so the next run tries again', async () => {
    h.notify.mockRejectedValue(new Error('resend down'))
    const { db } = dbReturning(usageRow(350, 0))
    const out = await checkQuotaUsage(db, { now: NOW })
    expect(out).toMatchObject({ alerted: false, alertFailed: true })
    expect(out).not.toHaveProperty('alertedOn')
  })

  it('uses the injected sender and last-alert reader when passed', async () => {
    const notify = vi.fn().mockResolvedValue(undefined)
    const lastAlertedOn = vi.fn().mockResolvedValue(null)
    const { db } = dbReturning(usageRow(0, 650))
    await checkQuotaUsage(db, { now: NOW, notify, lastAlertedOn })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(lastAlertedOn).toHaveBeenCalledTimes(1)
    expect(h.notify).not.toHaveBeenCalled()
    expect(h.lastResult).not.toHaveBeenCalled()
  })
})
