/**
 * F4 guard: every route that starts view-as or exports personal data in bulk
 * calls requireStepUp (lib/authz/step-up.ts), after its own authorisation check
 * and in the handler that serves the data. Ending view-as is never gated.
 * Removing a call, or moving it ahead of the route's own check, fails here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

/** route file → the handler body that must be gated, and the authorisation check it must follow. */
const GATED: { file: string; handler: string; after: string }[] = [
  { file: 'app/api/admin/impersonation/route.ts', handler: 'export async function POST(', after: 'assertPlatformAdmin(' },
  { file: 'app/api/admin/members/export/route.ts', handler: 'async function exportMembers(', after: "hasCapability('export')" },
  { file: 'app/api/admin/surveys/export/route.ts', handler: 'export async function GET(', after: "requireSurveyAdmin('export')" },
  { file: 'app/api/admin/events/[slug]/export/route.ts', handler: 'async function exportRoster(', after: 'requireEventRoute(' },
  { file: 'app/api/admin/access/objects/[id]/roster/route.ts', handler: 'export async function GET(', after: 'isStellrAdmin(' },
  { file: 'app/api/admin/events/[slug]/addons/bookings/route.ts', handler: "if (url.searchParams.get('format') === 'csv') {", after: 'crewFor(req, slug)' },
  { file: 'app/api/admin/events/[slug]/background-reports/route.ts', handler: 'export async function GET(', after: 'refuseOutsideStellr(' },
  { file: 'app/api/admin/members/[id]/background-check/report/route.ts', handler: 'export async function GET(', after: "hasCapability('export')" },
]

const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

/** The source from `start` to the next top-level declaration (or the end). */
function bodyFrom(src: string, start: string): string {
  const i = src.indexOf(start)
  expect(i, `${start} not found`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(i + start.length)
  const next = rest.search(/\n(export |async function |function |const [A-Z_]+ = )/)
  return start + (next === -1 ? rest : rest.slice(0, next))
}

describe('F4: routes that need a fresh sign-in factor', () => {
  for (const { file, handler, after } of GATED) {
    it(`${file} calls requireStepUp after ${after}`, () => {
      const src = read(file)
      expect(src).toContain("import { requireStepUp } from '@/lib/authz/step-up'")
      const body = bodyFrom(src, handler)
      const gate = body.indexOf('await requireStepUp()')
      expect(gate, `requireStepUp missing from ${handler}`).toBeGreaterThan(0)
      // The route's own check is either earlier in this body, or (bookings) earlier in the handler.
      const check = src.indexOf(after)
      expect(check, `${after} not found`).toBeGreaterThanOrEqual(0)
      expect(src.indexOf('await requireStepUp()', src.indexOf(handler))).toBeGreaterThan(check)
    })
  }

  it('ending a view-as session (DELETE) is never gated', () => {
    const body = bodyFrom(read('app/api/admin/impersonation/route.ts'), 'export async function DELETE(')
    expect(body).not.toContain('requireStepUp')
  })

  it('the add-on bookings JSON list and writes are not gated, only the CSV', () => {
    const src = read('app/api/admin/events/[slug]/addons/bookings/route.ts')
    expect(src.match(/await requireStepUp\(\)/g)).toHaveLength(1)
  })
})
