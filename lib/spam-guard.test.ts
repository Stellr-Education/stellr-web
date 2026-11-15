import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOCK_SKEW_MS, MAX_DWELL_MS, MIN_DWELL_MS, checkSpamSignals } from './spam-guard'

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0)
const req = new Request('https://www.stellreducation.org/api/contact', { method: 'POST' })

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  // The timing trap is enforced in production only; see the last block.
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  warn.mockRestore()
})

const real = { name: 'A Teacher', email: 'teacher@example.test' }

async function expectSilentAccept(res: Response | null) {
  expect(res).not.toBeNull()
  expect(res!.status).toBe(200)
  expect(await res!.json()).toEqual({ ok: true })
}

describe('checkSpamSignals: honeypot', () => {
  it('silently accepts a filled honeypot and logs only the route', async () => {
    const body = { ...real, website: 'https://spam.example', renderedAt: NOW - 60_000 }
    await expectSilentAccept(checkSpamSignals(body, req, 'contact'))
    expect(warn).toHaveBeenCalledWith('[spam] honeypot', 'contact')
    // Nothing from the body, and no IP, reaches the log.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('example')
  })

  it('trips on any non-blank value, not only strings', async () => {
    await expectSilentAccept(checkSpamSignals({ ...real, website: 1 }, req, 'contact'))
  })

  it('passes an empty or blank honeypot', () => {
    expect(checkSpamSignals({ ...real, website: '', renderedAt: NOW - 60_000 }, req, 'contact')).toBeNull()
    expect(checkSpamSignals({ ...real, website: '   ', renderedAt: NOW - 60_000 }, req, 'contact')).toBeNull()
  })
})

describe('checkSpamSignals: timing', () => {
  it('silently accepts a submission faster than the floor', async () => {
    const body = { ...real, website: '', renderedAt: NOW - (MIN_DWELL_MS - 1) }
    await expectSilentAccept(checkSpamSignals(body, req, 'subscribe'))
    expect(warn).toHaveBeenCalledWith('[spam] timing', 'subscribe')
  })

  it('silently accepts a renderedAt in the future', async () => {
    await expectSilentAccept(checkSpamSignals({ ...real, renderedAt: NOW + 60_000 }, req, 'subscribe'))
  })

  it('silently accepts a stale page past the ceiling', async () => {
    const body = { ...real, website: '', renderedAt: NOW - MAX_DWELL_MS - 1 }
    await expectSilentAccept(checkSpamSignals(body, req, 'white-paper'))
    expect(warn).toHaveBeenCalledWith('[spam] timing', 'white-paper')
  })

  it('passes a dwell between the floor and the ceiling', () => {
    expect(checkSpamSignals({ ...real, renderedAt: NOW - MIN_DWELL_MS }, req, 'contact')).toBeNull()
    expect(checkSpamSignals({ ...real, renderedAt: NOW - MAX_DWELL_MS }, req, 'contact')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts renderedAt as a numeric string', () => {
    expect(checkSpamSignals({ ...real, renderedAt: String(NOW - 10_000) }, req, 'contact')).toBeNull()
  })

  // A browser clock minutes off must not turn a real visit into "instant" or
  // "stale": the dwell is measured on the browser's own clock when it sends one.
  it('measures the dwell on the browser clock when submittedAt is sent', () => {
    const fastClock = NOW + 10 * 60_000
    const body = { ...real, renderedAt: fastClock - 30_000, submittedAt: fastClock }
    expect(checkSpamSignals(body, req, 'contact')).toBeNull()
  })

  it('still trips a fast submission on the browser clock', async () => {
    const body = { ...real, renderedAt: NOW - 60_000, submittedAt: NOW - 60_000 + 500 }
    await expectSilentAccept(checkSpamSignals(body, req, 'contact'))
  })

  it('passes a browser clock that is 10 minutes slow', () => {
    const slowClock = NOW - 10 * 60_000
    const body = { ...real, renderedAt: slowClock - 30_000, submittedAt: slowClock }
    expect(checkSpamSignals(body, req, 'contact')).toBeNull()
  })

  it('passes a browser clock right at the skew allowance', () => {
    const body = { ...real, renderedAt: NOW + CLOCK_SKEW_MS - 30_000, submittedAt: NOW + CLOCK_SKEW_MS }
    expect(checkSpamSignals(body, req, 'contact')).toBeNull()
  })
})

// The staleness half of the trap runs on the server's clock even when the
// browser sends submittedAt: a replayed real body keeps its plausible dwell.
describe('checkSpamSignals: stale or replayed bodies with submittedAt', () => {
  it('silently accepts a 7-hour-old body with a plausible dwell', async () => {
    const renderedAt = NOW - 7 * 60 * 60_000
    const body = { ...real, renderedAt, submittedAt: renderedAt + 10_000 }
    await expectSilentAccept(checkSpamSignals(body, req, 'contact'))
    expect(warn).toHaveBeenCalledWith('[spam] timing', 'contact')
  })

  it('silently accepts a body replayed just past the skew allowance', async () => {
    const submittedAt = NOW - CLOCK_SKEW_MS - 1
    const body = { ...real, renderedAt: submittedAt - 30_000, submittedAt }
    await expectSilentAccept(checkSpamSignals(body, req, 'contact'))
  })

  it('silently accepts forged epoch-start timestamps', async () => {
    await expectSilentAccept(checkSpamSignals({ ...real, renderedAt: 1, submittedAt: 5_001 }, req, 'contact'))
  })

  it('silently accepts timestamps further ahead than the skew allowance', async () => {
    const submittedAt = NOW + CLOCK_SKEW_MS + 1
    const body = { ...real, renderedAt: submittedAt - 30_000, submittedAt }
    await expectSilentAccept(checkSpamSignals(body, req, 'contact'))
  })

  it('still trips a dwell past the ceiling on the browser clock', async () => {
    const body = { ...real, renderedAt: NOW - MAX_DWELL_MS - 1, submittedAt: NOW }
    await expectSilentAccept(checkSpamSignals(body, req, 'contact'))
  })
})

describe('checkSpamSignals: missing timing', () => {
  // Pages cached before the deploy, and tabs running the previous bundle, send
  // no timing. They must keep working.
  it.each([
    ['missing', {}],
    ['empty', { renderedAt: '' }],
    ['unparseable', { renderedAt: 'yesterday' }],
    ['zero', { renderedAt: 0 }],
    ['an object', { renderedAt: { at: NOW } }],
  ])('accepts a %s renderedAt and warns', (_label, extra) => {
    expect(checkSpamSignals({ ...real, ...extra }, req, 'host-event')).toBeNull()
    expect(warn).toHaveBeenCalledWith('[spam] no-timing', 'host-event')
  })

  it('ignores a body that is not an object', () => {
    expect(checkSpamSignals(null, req, 'contact')).toBeNull()
    expect(checkSpamSignals(['website'], req, 'contact')).toBeNull()
  })
})

describe('checkSpamSignals: stripping', () => {
  it('removes the honeypot and timing fields from a passing body', () => {
    const body: Record<string, unknown> = {
      ...real,
      website: '',
      renderedAt: NOW - 10_000,
      submittedAt: NOW,
    }
    expect(checkSpamSignals(body, req, 'contact')).toBeNull()
    expect(body).toEqual(real)
  })

  it('removes them from a tripped body too', () => {
    const body: Record<string, unknown> = { ...real, website: 'x', renderedAt: NOW }
    checkSpamSignals(body, req, 'contact')
    expect(body).toEqual(real)
  })
})

describe('checkSpamSignals: outside production', () => {
  // The e2e suite is a fast form-filler by design. On dev and in CI the timing
  // trap logs and lets the submission through; the honeypot still bites.
  it('logs a timing trip but accepts it', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
    const body = { ...real, website: '', renderedAt: NOW - 500 }
    expect(checkSpamSignals(body, req, 'scholarship')).toBeNull()
    expect(warn).toHaveBeenCalledWith('[spam] timing (not enforced outside production)', 'scholarship')
    expect(body).toEqual(real)
  })

  it('still enforces the honeypot', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
    await expectSilentAccept(checkSpamSignals({ ...real, website: 'x', renderedAt: NOW - 500 }, req, 'contact'))
  })
})
