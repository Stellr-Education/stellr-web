// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { summarise } from './e2e-report-summary.mjs'

const report = {
  stats: { expected: 3, unexpected: 1, flaky: 0, skipped: 2 },
  suites: [
    {
      title: 'core/access-control.spec.ts',
      specs: [{ title: 'refuses a member', tests: [{ projectName: 'chromium', status: 'expected' }] }],
      suites: [
        {
          title: 'signed in as an event manager',
          specs: [{ title: 'reaches its assigned event', tests: [{ projectName: 'chromium', status: 'skipped' }] }],
        },
      ],
    },
    { title: 'mobile/nav.spec.ts', specs: [{ title: 'opens the menu', tests: [{ projectName: 'mobile-safari', status: 'skipped' }] }] },
  ],
}

describe('e2e-report-summary', () => {
  it('heads the summary with the job it was given, and lists every skipped test by project and path', () => {
    const out = summarise(report, 'e2e-tests')
    expect(out.split('\n')[0]).toBe('### e2e-tests result')
    expect(out).toContain('Passed 3, failed 1, flaky 0, skipped 2.')
    expect(out).toContain('- chromium: core/access-control.spec.ts › signed in as an event manager › reaches its assigned event')
    expect(out).toContain('- mobile-safari: mobile/nav.spec.ts › opens the menu')
    expect(out).not.toContain('refuses a member')
  })

  it('keeps e2e-local as the default heading', () => {
    expect(summarise({ ...report, suites: [] }).split('\n')[0]).toBe('### e2e-local result')
  })
})
