// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { idorTargetFor } from '@/lib/security/idor-targets'
import { followBodyHelpers, helperBodyInputs } from './body-helpers'

const ORGANISER = 'app/api/members/teams/[id]/participants/route.ts'

describe('body fields read through a shared helper (member-merge-school-email.16)', () => {
  it('the organiser’s add-participant route gets its id-bearing body keys back', () => {
    // One file, not idorTargets(): parsing every route is too slow for a unit test under load.
    const t = idorTargetFor(ORGANISER, 'participant', readFileSync(ORGANISER, 'utf8'))
    expect(t?.body).toEqual([])
    expect(followBodyHelpers(t!).body).toEqual(['email', 'membership_id', 'school_email'])
  })

  const files: Record<string, string> = {
    'lib/helper.ts': `
      export async function addThing(db: unknown, body: Record<string, unknown>) {
        const { teamId } = body
        if (body.note) return passOn(body)
        return body['schoolEmail']
      }
      function passOn(b: Record<string, unknown>) { return b.memberId }
      export function other(body: Record<string, unknown>) { return body.secretId }
    `,
  }
  const from = (helpers: Record<string, readonly string[]>) => ({ read: (f: string) => files[f] ?? '', exists: (f: string) => f in files, helpers })
  const route = (call: string) => `
    import { addThing, other } from '@/lib/helper'
    export async function POST(req: Request) {
      const body = await req.json().catch(() => null)
      return ${call}
    }
  `
  const FILE = 'app/api/x/route.ts'

  it('follows a listed helper at the body’s position, and the same-file functions it hands the body to', () => {
    expect(helperBodyInputs(FILE, route('addThing(null, body as Record<string, unknown>)'), from({ 'lib/helper': ['addThing'] }))).toEqual({
      body: ['memberId', 'schoolEmail', 'teamId'],
      fill: ['note'],
    })
  })

  it('follows nothing else: an unlisted helper, the body at another position, a value that is not the body', () => {
    expect(helperBodyInputs(FILE, route('addThing(null, body)'), from({}))).toEqual({ body: [], fill: [] })
    expect(helperBodyInputs(FILE, route('other(body)'), from({ 'lib/helper': ['addThing'] }))).toEqual({ body: [], fill: [] })
    expect(helperBodyInputs(FILE, route('addThing(body, null)'), from({ 'lib/helper': ['addThing'] }))).toEqual({ body: [], fill: [] })
    expect(helperBodyInputs(FILE, route('addThing(null, {})'), from({ 'lib/helper': ['addThing'] }))).toEqual({ body: [], fill: [] })
  })
})
