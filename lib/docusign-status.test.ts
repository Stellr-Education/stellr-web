import { describe, it, expect } from 'vitest'
import { describeEnvelope, describeMissingEnvelope, roleLabel, showsSignerList, signerSummaries } from './docusign-status'

// These cases are the real 4 Sept 2026 incident and its mirror image. A parent
// wrote in saying "we signed the consent form last week, what do we have to
// do?" — and the system had told them, in writing, that the guardian was the
// holdout. Getting the direction of that sentence right is the whole point of
// this module, so it is pinned here rather than left to the UI.

const guardianOutstanding = {
  name: 'Tamara Buk', email: 'tamarabuk7@gmail.com',
  role_name: 'Guardian', status: 'sent', delivered_at: null,
}
const studentSigned = {
  name: 'Leon Buk', email: 'gerybuki1@gmail.com',
  role_name: 'Minor', status: 'completed', delivered_at: '2026-08-26T18:36:19Z',
}

describe('describeEnvelope', () => {
  it('names the guardian when the student has signed and the guardian has not', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [guardianOutstanding, studentSigned],
    )
    expect(d.pill).toBe('partial')
    expect(d.label).toBe('Partially Complete · 1 of 2')
    expect(d.detail).toBe('Awaiting Tamara Buk (parent/guardian) — never opened')
    expect(d.waitingOn.map(r => r.email)).toEqual(['tamarabuk7@gmail.com'])
    expect(d.neverOpened).toHaveLength(1)
  })

  it('names the STUDENT in the mirror case — the reminder used to say the opposite', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [
        { ...guardianOutstanding, status: 'completed', delivered_at: '2026-08-26T10:00:00Z' },
        { ...studentSigned, status: 'sent', delivered_at: '2026-08-26T11:00:00Z' },
      ],
    )
    expect(d.pill).toBe('partial')
    expect(d.detail).toBe('Awaiting Leon Buk (student)')
    expect(d.waitingOn.map(r => r.role_name)).toEqual(['Minor'])
  })

  it('drops the "never opened" qualifier once the signer has opened the link', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [{ ...guardianOutstanding, delivered_at: '2026-09-01T09:00:00Z' }, studentSigned],
    )
    expect(d.detail).toBe('Awaiting Tamara Buk (parent/guardian)')
  })

  it('lists both signers while nobody has signed', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 0 },
      [guardianOutstanding, { ...studentSigned, status: 'sent', delivered_at: null }],
    )
    expect(d.pill).toBe('issued')
    expect(d.detail).toBe('Awaiting Tamara Buk (parent/guardian) and Leon Buk (student) — never opened')
  })

  it('reports a bounced address ahead of partial progress', () => {
    // DocuSign calls this 'autoresponded'. We used to discard it entirely, so a
    // dead address looked exactly like a slow one and got chased forever.
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [{ ...guardianOutstanding, status: 'autoresponded' }, studentSigned],
    )
    expect(d.pill).toBe('bounced')
    expect(d.detail).toContain('Email bounced for Tamara Buk (parent/guardian)')
    expect(d.waitingOn).toHaveLength(0)
    expect(d.bounced).toHaveLength(1)
  })

  it('names who declined', () => {
    const d = describeEnvelope(
      { status: 'declined', signers_total: 2, signers_completed: 0 },
      [{ ...guardianOutstanding, status: 'declined' }, studentSigned],
    )
    expect(d.pill).toBe('declined')
    expect(d.detail).toBe('Declined by Tamara Buk (parent/guardian)')
  })

  it('treats a coverage row as on-file', () => {
    const d = describeEnvelope({ status: 'completed', reused_from: 'abc' }, [])
    expect(d.pill).toBe('on_file')
    expect(d.detail).toBeNull()
  })

  it('says so plainly when the counts show partial but no recipients are known', () => {
    // Envelopes issued before migration 148 have counts but no recipient rows.
    // Inventing a name here would be worse than admitting we do not have one.
    const d = describeEnvelope({ status: 'sent', signers_total: 2, signers_completed: 1 }, [])
    expect(d.pill).toBe('partial')
    expect(d.detail).toContain('outstanding signer unknown')
  })

  it('flags a voided envelope as needing re-issue', () => {
    const d = describeEnvelope({ status: 'voided', signers_total: 2, signers_completed: 1 }, [])
    expect(d.pill).toBe('voided')
    expect(d.detail).toBe('Voided — re-issue required')
  })

  // 28 Oct 2026: two refused sends (guardian "none" / "…@gmailcom") read
  // "Voided" on the roster, and nobody could tell why.
  it('tells a refused send apart from a void, and names the fix', () => {
    const d = describeEnvelope({
      status: 'voided',
      signers_total: 0,
      envelope_id: 'failed:65fbd000-0000-4000-8000-000000000000',
      issue_error: 'DocuSign create envelope failed: {"errorCode":"INVALID_EMAIL_ADDRESS_FOR_RECIPIENT"}',
    })
    expect(d.pill).toBe('failed')
    expect(d.label).toBe('Couldn’t Send')
    expect(d.detail).toMatch(/email address on it is invalid/)
  })

  it('still reads a real voided envelope as voided', () => {
    const d = describeEnvelope({ status: 'voided', envelope_id: '45bb31be-41cd-88d1-8149-1aea7356f0a2' })
    expect(d.pill).toBe('voided')
  })

  it('is complete when the envelope is complete', () => {
    const d = describeEnvelope(
      { status: 'completed', signers_total: 2, signers_completed: 2 },
      [{ ...guardianOutstanding, status: 'completed' }, studentSigned],
    )
    expect(d.pill).toBe('complete')
    expect(d.detail).toBeNull()
    expect(d.waitingOn).toHaveLength(0)
  })
})

describe('describeMissingEnvelope', () => {
  it('distinguishes "required but never issued" from "not required"', () => {
    expect(describeMissingEnvelope(true).pill).toBe('not_issued')
    expect(describeMissingEnvelope(false).pill).toBe('not_required')
    expect(describeMissingEnvelope(false).detail).toBeNull()
  })
})

describe('roleLabel', () => {
  it('translates DocuSign template roles into words a family would use', () => {
    expect(roleLabel('Guardian')).toBe('parent/guardian')
    expect(roleLabel('Minor')).toBe('student')
    expect(roleLabel('StellrRepresentative')).toBe('Stellr counter-signature')
    expect(roleLabel(null)).toBe('signer')
  })
})

// Shared-inbox consent envelopes route the student after the guardian (#243).
// Until the guardian signs, DocuSign holds the student at recipient status
// 'created' — nothing has been emailed, so "never opened" would be false.
describe('describeEnvelope — queued signer (shared inbox)', () => {
  const guardian = {
    name: 'Anne Byron', email: 'anne@example.org',
    role_name: 'Guardian', status: 'sent', delivered_at: null,
  }
  const queuedStudent = {
    name: 'Ada Lovelace', email: 'anne@example.org',
    role_name: 'Minor', status: 'created', delivered_at: null,
  }

  it('reports the student as queued, not never-opened', () => {
    const d = describeEnvelope({ status: 'sent', signers_total: 2, signers_completed: 0 }, [guardian, queuedStudent])
    expect(d.pill).toBe('issued')
    expect(d.detail).toBe(
      'Awaiting Anne Byron (parent/guardian) — never opened; Ada Lovelace (student) queued — sent once the parent/guardian signs',
    )
    expect(d.queued.map(r => r.name)).toEqual(['Ada Lovelace'])
    expect(d.neverOpened.map(r => r.name)).toEqual(['Anne Byron'])
    expect(d.waitingOn).toHaveLength(2)
  })

  it('drops "never opened" once the guardian has opened it', () => {
    const d = describeEnvelope(
      { status: 'delivered', signers_total: 2, signers_completed: 0 },
      [{ ...guardian, status: 'delivered', delivered_at: '2026-09-28T10:00:00Z' }, queuedStudent],
    )
    expect(d.detail).toBe('Awaiting Anne Byron (parent/guardian); Ada Lovelace (student) queued — sent once the parent/guardian signs')
    expect(d.neverOpened).toHaveLength(0)
  })

  it('treats the student as an ordinary outstanding signer once DocuSign sends it', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [{ ...guardian, status: 'completed', delivered_at: '2026-09-28T10:00:00Z' }, { ...queuedStudent, status: 'sent' }],
    )
    expect(d.detail).toBe('Awaiting Ada Lovelace (student) — never opened')
    expect(d.queued).toHaveLength(0)
  })
})

// 22 Nov 2026: a student's school address bounced and the card showed only
// "Email Bounced", hiding that the parent had signed five days earlier. The
// per-signer list is the fix; these pin what each line says.
describe('signerSummaries', () => {
  const parent = { name: 'Pat Example', email: 'pat@example.com', role_name: 'Guardian', status: 'completed', delivered_at: '2026-11-17T20:37:54Z', signed_at: '2026-11-17T20:38:24Z' }
  const student = { name: 'Sam Example', email: 'sam@school.example', role_name: 'Minor', status: 'autoresponded', delivered_at: null }

  it('shows the parent signed and the student bounced', () => {
    const d = describeEnvelope({ status: 'sent', signers_total: 2, signers_completed: 1 }, [parent, student])
    expect(d.pill).toBe('bounced')
    expect(showsSignerList(d)).toBe(true)
    expect(d.signers).toEqual([
      { name: 'Pat Example', role: 'Parent', tone: 'done', status: 'Signed', signedAt: '2026-11-17T20:38:24Z' },
      { name: 'Sam Example', role: 'Student', tone: 'attention', status: 'Email bounced', signedAt: null },
    ])
  })

  it('names who has already signed in the bounced sentence', () => {
    const d = describeEnvelope({ status: 'sent', signers_total: 2, signers_completed: 1 }, [parent, student])
    expect(d.detail).toBe('Email bounced for Sam Example (student). Pat Example (parent/guardian) has signed. Use Correct email: signatures already given are kept')
  })

  it('says only the bounce when nobody has signed yet', () => {
    const d = describeEnvelope({ status: 'sent' }, [{ ...parent, status: 'sent', signed_at: null }, student])
    expect(d.detail).toBe('Email bounced for Sam Example (student). Use Correct email: signatures already given are kept')
  })

  it('tells not opened, opened, queued, sending soon and declined apart', () => {
    const s = signerSummaries([
      { name: 'A', email: 'a@example.com', role_name: 'Guardian', status: 'sent', delivered_at: null },
      { name: 'B', email: 'b@example.com', role_name: 'Minor', status: 'created' },
    ])
    expect(s.map((x) => [x.tone, x.status])).toEqual([['waiting', 'Not opened'], ['queued', 'After parent signs']])

    expect(signerSummaries([{ name: 'C', email: 'c@example.com', role_name: 'Adult', status: 'delivered', delivered_at: '2026-11-01T00:00:00Z' }])[0])
      .toMatchObject({ role: 'Participant', tone: 'waiting', status: 'Opened, not signed' })
    expect(signerSummaries([{ name: 'D', email: 'd@example.com', role_name: 'Mentor', status: 'sent', unsent: true }])[0])
      .toMatchObject({ tone: 'waiting', status: 'Sending soon' })
    expect(signerSummaries([{ name: 'E', email: 'e@example.com', role_name: 'Guardian', status: 'declined' }])[0])
      .toMatchObject({ tone: 'attention', status: 'Declined' })
  })

  it('leaves out Stellr’s counter-signature: one line for a mentor', () => {
    const s = signerSummaries([
      { name: 'M', email: 'm@example.com', role_name: 'Mentor', status: 'sent', delivered_at: null },
      { name: 'Stellr', email: 'ops@example.com', role_name: 'StellrRepresentative', status: 'created' },
    ])
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ role: 'Mentor', status: 'Not opened' })
  })

  it('keeps the single pill once signing is settled', () => {
    const d = describeEnvelope({ status: 'completed' }, [parent, { ...student, status: 'completed' }])
    expect(showsSignerList(d)).toBe(false)
  })
})
