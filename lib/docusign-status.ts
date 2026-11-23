// The single vocabulary for "where is this agreement up to", shared by the event
// roster, the admin Consent forms table, the member portal and the reminder cron.
//
// WHY (4 Sept 2026): those four surfaces each derived their own answer from an
// envelope-level status plus two integers, and disagreed. A 1-of-2 envelope read
// "Partially Complete" on the roster, "Awaiting signature" in the admin table
// (which never even selected the counts), "Partially complete · 1 of 2 signed"
// in the portal, and the reminder email simply asserted the guardian was the
// holdout without checking. None of them could name the outstanding person,
// which is the only thing anyone needs to know.
//
// Everything here is pure. Callers pass the envelope row plus its recipients
// (agreement_recipients, migration 148); this module decides what it means.

export type DocusignPill =
  | 'not_required'
  | 'not_issued'
  | 'issued'
  | 'partial'
  | 'bounced'
  | 'declined'
  | 'voided'
  | 'failed'
  | 'complete'
  | 'on_file'

export interface EnvelopeLike {
  status: string
  signers_total?: number | null
  signers_completed?: number | null
  /** Set when this row is coverage carried from previously signed paperwork. */
  reused_from?: string | null
  /**
   * "failed:<uuid>" marks a send the signing service refused: nothing was ever
   * sent, so it is not a void. Pass it (and issue_error) to tell the two apart.
   */
  envelope_id?: string | null
  issue_error?: string | null
}

const FAILED_PREFIX = 'failed:'

/**
 * Why a send was refused, in words an admin can act on. The raw provider error
 * stays in agreements.issue_error; this only names the fix for the common cases.
 */
export function describeIssueError(error: string | null | undefined): string {
  const e = error ?? ''
  if (/INVALID_EMAIL_ADDRESS|invalid email|email address .* invalid/i.test(e)) {
    return 'An email address on it is invalid (often the parent/guardian). Fix it on the participant, then Reissue'
  }
  if (/ENVELOPE_ALLOWANCE_EXCEEDED|allowance/i.test(e)) {
    return 'DocuSign’s monthly allowance was used up. Reissue to send it through Stellr signing'
  }
  if (/missing guardian/i.test(e)) return 'No parent/guardian on the record. Add one, then Reissue'
  return e ? `The signing service refused it: ${e.slice(0, 140)}` : 'The signing service refused it. Reissue to try again'
}

export interface RecipientLike {
  name: string
  email: string
  role_name?: string | null
  status: string
  /** Null on a 'sent' recipient = never opened the signing link. */
  delivered_at?: string | null
  /** When this signer signed (agreement_recipients.signed_at). */
  signed_at?: string | null
  /**
   * Stellr signing only: it is this signer's turn, but their signing email is
   * still in the queue (the daily email limit was reached). Not "never opened":
   * they have nothing to open yet.
   */
  unsent?: boolean
}

export interface EnvelopeDescription {
  pill: DocusignPill
  /** Short pill text, e.g. "Partially Complete". */
  label: string
  /** One line naming who is outstanding, or null when nobody is. */
  detail: string | null
  /** Signers who still have to act — the answer to "who do I chase?". */
  waitingOn: RecipientLike[]
  /** Signers whose email address bounced (DocuSign 'autoresponded'). */
  bounced: RecipientLike[]
  /** Outstanding signers who have never opened the link. */
  neverOpened: RecipientLike[]
  /**
   * Outstanding signers DocuSign has not emailed yet, because an earlier signer
   * in the routing order must sign first (status 'created'). Consent envelopes
   * whose student and guardian share an inbox route the student second, so the
   * student sits here until the guardian signs. Never counted as "never opened":
   * there is nothing to open yet.
   */
  queued: RecipientLike[]
  /** Outstanding signers whose signing email has not gone out yet (Stellr signing). */
  unsent: RecipientLike[]
  /**
   * One entry per person who has to sign, in routing order: the compact
   * per-signer view. Excludes Stellr's own counter-signature (internal, not
   * something a family or admin chases). Empty when no recipients are loaded.
   */
  signers: SignerSummary[]
}

/**
 * How a signer's status reads at a glance. Colour is never the only cue: each
 * tone pairs with an icon and a status word in the UI (WCAG 1.4.1).
 *   done      signed
 *   attention needs someone to act (bounced, declined)
 *   waiting   their turn, not signed yet
 *   queued    not their turn yet
 */
export type SignerTone = 'done' | 'attention' | 'waiting' | 'queued'

export interface SignerSummary {
  name: string
  /** Short role, capitalised: "Parent", "Student", "Mentor"… */
  role: string
  tone: SignerTone
  /** Two or three words: "Signed", "Email bounced", "Not opened". */
  status: string
  /** ISO time the signer signed, for "Signed 17 Nov". */
  signedAt: string | null
}

const PILL_LABELS: Record<DocusignPill, string> = {
  not_required: 'Not Required',
  not_issued:   'Not Issued',
  issued:       'Issued',
  partial:      'Partially Complete',
  bounced:      'Email Bounced',
  declined:     'Declined',
  voided:       'Voided',
  failed:       'Couldn’t Send',
  complete:     'Complete',
  on_file:      'On File',
}

export const PILL_CLASSES: Record<DocusignPill, string> = {
  not_required: 'bg-brand-hairline text-brand-muted-soft',
  not_issued:   'bg-red-100 text-red-700',
  issued:       'bg-red-100 text-red-700',
  partial:      'bg-orange-100 text-orange-700',
  // Red, not orange: a bounced address never resolves by waiting. Someone has to
  // correct the address ("Correct email": same envelope, nothing re-issued).
  bounced:      'bg-red-100 text-red-700',
  declined:     'bg-red-100 text-red-700',
  voided:       'bg-brand-hairline text-brand-muted-soft',
  // Red: nobody has been asked to sign, and waiting will not change that.
  failed:       'bg-red-100 text-red-700',
  complete:     'bg-green-100 text-green-700',
  on_file:      'bg-teal-100 text-teal-700',
}

/** Human wording for a DocuSign template role. */
export function roleLabel(roleName: string | null | undefined): string {
  switch ((roleName ?? '').toLowerCase()) {
    case 'guardian':             return 'parent/guardian'
    case 'minor':                return 'student'
    case 'adult':                return 'participant'
    case 'mentor':               return 'mentor'
    case 'volunteer':            return 'volunteer'
    case 'stellrrepresentative': return 'Stellr counter-signature'
    case 'member':               return 'member'
    default:                     return 'signer'
  }
}

/** Short, capitalised role for the per-signer list. */
export function shortRoleLabel(roleName: string | null | undefined): string {
  switch ((roleName ?? '').toLowerCase()) {
    case 'guardian':  return 'Parent'
    case 'minor':     return 'Student'
    case 'adult':     return 'Participant'
    case 'mentor':    return 'Mentor'
    case 'volunteer': return 'Volunteer'
    case 'member':    return 'Member'
    default:          return 'Signer'
  }
}

const COUNTERSIGN_ROLE = 'stellrrepresentative'

/**
 * True while signing is under way and the per-signer list is the useful view.
 * Settled states (complete, on file, voided, declined, couldn't send) read
 * better as a single pill.
 */
export function showsSignerList(d: Pick<EnvelopeDescription, 'pill' | 'signers'>): boolean {
  return (d.pill === 'issued' || d.pill === 'partial' || d.pill === 'bounced') && d.signers.length > 0
}

function summariseSigner(r: RecipientLike, turnRoles: string): SignerSummary {
  const base = {
    name: r.name || r.email,
    role: shortRoleLabel(r.role_name),
    signedAt: r.signed_at ?? null,
  }
  switch (r.status) {
    case 'completed':     return { ...base, tone: 'done', status: 'Signed' }
    case 'autoresponded': return { ...base, tone: 'attention', status: 'Email bounced' }
    case 'declined':      return { ...base, tone: 'attention', status: 'Declined' }
    case QUEUED_RECIPIENT_STATUS:
      return { ...base, tone: 'queued', status: turnRoles ? `After ${turnRoles} signs` : 'Not sent yet' }
  }
  if (r.unsent) return { ...base, tone: 'waiting', status: 'Sending soon' }
  if (r.status === 'delivered' || r.delivered_at) return { ...base, tone: 'waiting', status: 'Opened, not signed' }
  return { ...base, tone: 'waiting', status: 'Not opened' }
}

/** The per-signer list, in the order the recipients were given (routing order). */
export function signerSummaries(recipients: RecipientLike[]): SignerSummary[] {
  const people = recipients.filter((r) => (r.role_name ?? '').toLowerCase() !== COUNTERSIGN_ROLE)
  const turnRoles = [...new Set(
    people
      .filter((r) => !TERMINAL_RECIPIENT_STATUSES.has(r.status) && r.status !== 'autoresponded' && r.status !== QUEUED_RECIPIENT_STATUS)
      .map((r) => shortRoleLabel(r.role_name).toLowerCase()),
  )].join(' and ')
  return people.map((r) => summariseSigner(r, turnRoles))
}

function describeSigner(r: RecipientLike): string {
  const role = roleLabel(r.role_name)
  return r.name ? `${r.name} (${role})` : `${r.email} (${role})`
}

function joinNames(list: RecipientLike[]): string {
  const names = list.map(describeSigner)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const TERMINAL_RECIPIENT_STATUSES = new Set(['completed', 'declined'])

// DocuSign's recipient status for a signer whose turn in the routing order has
// not come yet. Distinct from 'sent' with no delivered_at (emailed, not opened).
const QUEUED_RECIPIENT_STATUS = 'created'

/**
 * Paperwork is required but no envelope exists at all — or none is required.
 * Kept here so the roster's "no envelope row" branch speaks the same vocabulary
 * as every other case rather than hand-rolling its own pill.
 */
/**
 * What a send attempt did, in words for staff. The dispatch codes (in_flight,
 * on_file…) are for logs; an admin read "No envelope sent (in_flight)" in green
 * and could not tell if that was good news.
 */
export function describeDispatchOutcome(outcome: string): string {
  switch (outcome) {
    case 'issued': return 'New consent form sent.'
    case 'in_flight': return 'Already out for signature, so nothing new was sent.'
    case 'on_file': return 'A signed form is already on file, so nothing new was sent.'
    case 'not_required': return 'No consent form is required for this person.'
    case 'failed': return 'The form could not be sent.'
    default: return 'Nothing new was sent.'
  }
}

export function describeMissingEnvelope(required: boolean): EnvelopeDescription {
  return {
    pill:  required ? 'not_issued' : 'not_required',
    label: PILL_LABELS[required ? 'not_issued' : 'not_required'],
    detail: required ? 'Paperwork is required but no envelope has been issued' : null,
    waitingOn: [], bounced: [], neverOpened: [], queued: [], unsent: [], signers: [],
  }
}

export function describeEnvelope(
  env: EnvelopeLike,
  recipients: RecipientLike[] = [],
): EnvelopeDescription {
  const total = env.signers_total ?? Math.max(recipients.length, 1)
  const completed = env.signers_completed ?? recipients.filter((r) => r.status === 'completed').length

  const bounced = recipients.filter((r) => r.status === 'autoresponded')
  const waitingOn = recipients.filter(
    (r) => !TERMINAL_RECIPIENT_STATUSES.has(r.status) && r.status !== 'autoresponded',
  )
  const queued = waitingOn.filter((r) => r.status === QUEUED_RECIPIENT_STATUS)
  const active = waitingOn.filter((r) => r.status !== QUEUED_RECIPIENT_STATUS)
  const unsent = active.filter((r) => r.unsent)
  const neverOpened = active.filter((r) => !r.delivered_at && !r.unsent)

  const base = { waitingOn, bounced, neverOpened, queued, unsent, signers: signerSummaries(recipients) }

  // Coverage rows carry paperwork signed for an earlier event; they are complete
  // by construction and have no recipients of their own.
  if (env.reused_from) {
    return { pill: 'on_file', label: PILL_LABELS.on_file, detail: null, ...base }
  }
  if (env.status === 'completed') {
    return { pill: 'complete', label: PILL_LABELS.complete, detail: null, ...base }
  }
  if (env.status === 'declined') {
    const who = recipients.find((r) => r.status === 'declined')
    return {
      pill: 'declined',
      label: PILL_LABELS.declined,
      detail: who ? `Declined by ${describeSigner(who)}` : 'Declined',
      ...base,
    }
  }
  if (env.envelope_id?.startsWith(FAILED_PREFIX)) {
    return { pill: 'failed', label: PILL_LABELS.failed, detail: describeIssueError(env.issue_error), ...base }
  }
  if (env.status === 'voided') {
    return { pill: 'voided', label: PILL_LABELS.voided, detail: 'Voided — re-issue required', ...base }
  }

  // A bounced address outranks "partially complete": waiting will never resolve
  // it, and it is invisible everywhere else in the system.
  // Name who has already signed too: without it a bounce hid a completed
  // parent signature (22 Nov 2026), and the admin could not tell whether the
  // family had done their part.
  if (bounced.length > 0) {
    const signed = recipients.filter((r) => r.status === 'completed' && (r.role_name ?? '').toLowerCase() !== COUNTERSIGN_ROLE)
    const signedNote = signed.length > 0
      ? ` ${joinNames(signed)} ${signed.length === 1 ? 'has' : 'have'} signed.`
      : ''
    return {
      pill: 'bounced',
      label: PILL_LABELS.bounced,
      detail: `Email bounced for ${joinNames(bounced)}.${signedNote} Use Correct email: signatures already given are kept`,
      ...base,
    }
  }

  const partial = completed > 0 && completed < total
  const pill: DocusignPill = partial ? 'partial' : 'issued'

  let detail: string | null = null
  if (waitingOn.length > 0) {
    const parts: string[] = []
    const emailed = active.filter((r) => !r.unsent)
    if (emailed.length > 0) {
      const never = neverOpened.length === emailed.length
      parts.push(`Awaiting ${joinNames(emailed)}${never ? ' — never opened' : ''}`)
    }
    if (unsent.length > 0) {
      parts.push(`Signing email to ${joinNames(unsent)} not sent yet — goes out within a day (daily email limit)`)
    }
    if (queued.length > 0) {
      const before = active.length > 0
        ? [...new Set(active.map((r) => roleLabel(r.role_name)))].join(' and ')
        : 'earlier signer'
      parts.push(`${joinNames(queued)} queued — sent once the ${before} signs`)
    }
    detail = parts.join('; ')
  } else if (partial) {
    // Counts say partial but we have no recipient rows yet (envelope issued
    // before migration 148, or the webhook has not synced it). Say so rather
    // than inventing a name.
    detail = `${completed} of ${total} signed — outstanding signer unknown, re-sync from DocuSign`
  }

  return {
    pill,
    label: partial ? `${PILL_LABELS.partial} · ${completed} of ${total}` : PILL_LABELS.issued,
    detail,
    ...base,
  }
}
