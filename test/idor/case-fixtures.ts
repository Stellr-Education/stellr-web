// Per-route fixtures for the generated IDOR suite: what a case needs so its
// Canary id reaches the code that decides, instead of stopping at request
// validation (`unexercised`) or an unconfigured integration (`error`).
//
// A fixture may only get the request further. It never decides an outcome:
//   - `body` is sent under the id inputs, so a fixture cannot replace a honeytoken;
//   - `inputs` swaps an id input for a real value only where the input names no
//     tenant record (a static page key), and every other id input stays Canary;
//   - `callerRows` and `member` are the CALLER'S own rows, so a filter scoped to
//     the caller finds them. The honey row still answers every filter that is
//     not scoped to an identity;
//   - `honey` sets non-identity columns on the honey row (a registration's type),
//     so a route reaches its ownership check instead of stopping on the row's
//     shape. It cannot change who the row belongs to: filters read identity
//     columns from the row's own model, not from these values.
// The outcome is still classified by test/idor/harness.ts and pinned in the
// snapshot. Nothing here reads a real credential: every env value is a dummy
// and the network stays closed (`fetch` answers only the URLs a fixture names).
// test/idor/case-fixtures.test.ts holds these rules as allow-lists.
//
// A fixture that reaches a Canary write is not accepted into the snapshot unless the
// write is shown to be harmless: the snapshot then carries the reviewed reason, and
// `writes` here names exactly the tables the case may write, so a new write on the same
// route still fails. A write that is not harmless goes in HELD_BACK_FIXTURES, and the
// route stays pinned as it was until its owner fixes it.
//
// register/group and register/individual: this suite models no Sanity event, except for
// a fixture that sets `event`. Then host B's open event answers its slug, as in
// test/idor/tenant-host-routes.test.ts, so the case reaches the route's own event check
// instead of a 404 no id caused. The bodies are shared with
// test/idor/tenant-host-targets.ts, so both suites send the same registration.

export interface CaseFixture {
  /** What the route stopped on without this fixture. */
  reason: string
  /** Limit the fixture to these methods; every method when omitted. */
  methods?: string[]
  /** Non-id body fields, sent under the generated id inputs. */
  body?: Record<string, unknown>
  /** Id inputs that name no tenant record: their real value, replacing the honeytoken. */
  inputs?: Record<string, string>
  /** Dummy configuration, set while the route loads and runs, then restored. */
  env?: Record<string, string>
  /** The caller's own rows, by table (a licence the route requires, say). */
  callerRows?: Record<string, Record<string, unknown>[]>
  /** Merged into the caller's `members` row. */
  member?: Record<string, unknown>
  /** Non-identity columns of the honey row, where a route branches on its shape first. */
  honey?: Record<string, unknown>
  /** Answer Stripe's create calls (test/idor/harness.ts stripeMock) instead of rejecting them. */
  stripe?: boolean
  /** Answer outbound requests to these integrations instead of the harness's 503. */
  fetch?: (url: string) => Response | undefined
  /**
   * Set only when a refusal is a real decision made before any query (a signature
   * check, a string compare on the id): what decides. Without it, a `refused` that
   * used no Canary value fails test/idor/idor-routes.test.ts.
   */
  refusesWithoutQuery?: string
  /**
   * Host B's open event answers its slug (test/idor/idor-routes.test.ts mocks lib/sanity
   * for this case only), so a registration reaches the route's event check. Without it the
   * generated suite models no event. The tenant-host suite always models one.
   */
  event?: boolean
  /**
   * For a case whose snapshot entry accepts a honey_write: exactly the tables (or Stripe
   * calls) it writes with a Canary value. test/idor/idor-routes.test.ts fails when the set
   * differs, so the accepted reason covers these writes and no other.
   */
  writes?: readonly string[]
  /**
   * Honey columns that make the route's own access rule refuse. idor-routes.test.ts proves
   * the case then comes back `refused` with no write, so that rule is pinned apart from the
   * accepted outcome.
   */
  refusedWhen?: Record<string, unknown>
  /** Further values the honey row's token columns answer to (a valid link's hash). Tenant-host cases only. */
  honeyTokens?: readonly string[]
  /** Cookies the request carries (a signing session). Tenant-host cases only. */
  cookies?: Record<string, string>
  /** Extra request headers (x-sign-ref). Tenant-host cases only. */
  headers?: Record<string, string>
  /** What a named rpc answers, where a route stops unless it says yes. Tenant-host cases only. */
  rpcAnswers?: Record<string, unknown>
  /** Send no Origin header, as a caller outside a browser may. Tenant-host cases only. */
  omitOrigin?: boolean
  /**
   * Generated body inputs to leave out, where another one is what the case tests (a
   * registration for host B's event, with no offer or school of host B's). In the generated
   * suite only where test/idor/case-fixtures.test.ts allows it.
   */
  omitInputs?: readonly string[]
  /**
   * For a staff persona on a tenant_crew route that really cannot get to the id: why.
   * crewCaseProblem in test/idor/harness.ts refuses the case otherwise.
   */
  crewUnproven?: Partial<Record<'stellr_crew' | 'canary_admin' | 'stellr_event_manager' | 'stellr_staff', string>>
}

const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_x' }
const STRIPE_MEMBER = { stripe_customer_id: 'cus_idorharness' }
// lib/gated-download-link.ts refuses a secret under 32 characters.
const DUMMY_SECRET = 'x'.repeat(32)
const SIGNING_ENV = { ASSET_LINK_SECRET: DUMMY_SECRET }
const STRIPE_CHECKOUT = { env: STRIPE_ENV, member: STRIPE_MEMBER, stripe: true }
/** HubSpot's forms endpoint, the one lead-capture write that needs no token. */
const hubspotForms = (url: string) => (url.startsWith('https://api.hsforms.com/') ? Response.json({ inlineMessage: 'ok' }) : undefined)

// A person's details that pass the registration form's checks, on an address nobody else
// holds. Shared with test/idor/tenant-host-targets.ts.
export const REGISTRANT_EMAIL = 'registrant@tenant-a.invalid'
export const REGISTRANT = {
  first_name: 'Tenant',
  last_name: 'Registrant',
  date_of_birth: '2000-01-01',
  phone: '0000000000',
  gender: 'prefer_not_to_say',
  t_shirt_size: 'M',
  age_bracket: 'adult',
  event_role: 'teacher',
  school_name: 'Tenant A School',
}

/** The group form's required shape, with no payment: the event has no Stripe price. */
export const GROUP_REGISTRATION_BODY = {
  teacher: { ...REGISTRANT, email: REGISTRANT_EMAIL },
  teacher_poc: null,
  registrant_role: 'teacher',
  adult_count: 1,
  student_count: 2,
  total_participants: 3,
  details_method: 'email_link',
  // The event has no Stripe price, and card or invoice would stop on that, not on whose event it is.
  payment_method: 'none',
  member_pays_individually: false,
  additional_adults: [],
  students: [],
  school_dpa_agreed: true,
}

// The caller's own Membership Agreement, signed today, so onboarding does not issue one.
// Issuing one fails here (signing is not configured) and alerts the Stellr duty holders,
// whom the honey admin_duties row stands in for: a write about the caller, not the school.
const SIGNED_TODAY = new Date().toISOString()
const CALLER_AGREEMENT_ON_FILE = {
  agreements: [
    {
      id: '00000000-0000-4000-8000-00000000a003',
      member_id: '00000000-0000-4000-8000-00000000a001',
      status: 'completed',
      envelope_type: 'adult',
      completed_at: SIGNED_TODAY,
      agreement_version: null,
    },
  ],
}

// B9 (migration 20261106234759_community_stellr_only_check.sql): community and training
// are Stellr's, held by the database. Every post hangs off a Space
// (community_posts.space_id is NOT NULL), every comment off a post, and
// community_spaces_stellr_only, community_resources_stellr_only and
// mentoring_cohorts_stellr_only allow only Stellr's tenant or NULL. So no post, comment,
// resource or cohort is another tenant's, and the S5 host allow-list keeps community
// routes off tenant hosts. The honey row stands in for a real Stellr row the member can see.
const B9_COMMUNITY = 'B9 holds community on Stellr, so the honey row is a Stellr row the member can see'
const CANARY_OPEN_SPACE_POST = { status: 'published', is_archived: false, access_type: 'open' }

const STAFF_NO_SCHOLARSHIPS =
  'deciding on a scholarship is admin-only (owner, 2 Oct 2026): Staff do not hold scholarships:write, so requireScholarshipAdmin refuses Staff before the application is read (C20)'

export const CASE_FIXTURES: Record<string, CaseFixture> = {
  // ── request shape: enums and zod bodies ────────────────────────────────────
  'app/api/community/cohorts/respond/route.ts': {
    reason: 'action must be accept or decline',
    body: { action: 'accept' },
  },
  'app/api/community/spaces/invite/respond/route.ts': {
    reason: 'action must be accept or decline',
    body: { action: 'accept' },
  },
  'app/api/community/sessions/actions/route.ts': {
    reason: 'done must be a boolean',
    body: { done: true },
  },
  'app/api/community/comments/route.ts': {
    reason: 'bodyJson must be a Tiptap document with text, and only a published post goes on to the access check',
    honey: { status: 'published' },
    body: { bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'IDOR harness reply' }] }] } },
  },
  'app/api/community/posts/route.ts': {
    reason: "PATCH only accepts action 'toggle-announcement'",
    methods: ['PATCH'],
    body: { action: 'toggle-announcement' },
  },
  'app/api/admin/docusigns/[id]/credential-sharing/route.ts': {
    reason: 'optOut must be a boolean, and the route checks that before it loads the agreement',
    refusesWithoutQuery: 'the participant holds no role: the tenant admin check answers before any read',
    body: { optOut: true },
  },
  // A row that is not a group answers 404 before the event check would, so without this the
  // event manager's case passes whether or not the route confines them.
  'app/api/admin/registrations/[id]/finish-setup/route.ts': {
    reason: 'only a group registration goes on to the event check',
    refusesWithoutQuery: 'the participant holds no role: the staff check answers before any read',
    honey: { type: 'group' },
  },
  'app/api/admin/registrations/[id]/invoice/route.ts': {
    reason: 'only a group registration goes on to the event check',
    refusesWithoutQuery: 'the participant holds no role: the staff check answers before any read',
    honey: { type: 'group' },
  },
  'app/api/admin/registrations/[id]/participants/route.ts': {
    reason: 'only a group registration goes on to the event check',
    refusesWithoutQuery: 'the participant holds no role: the staff check answers before any read',
    honey: { type: 'group' },
  },
  'app/api/admin/registrations/[id]/payment-method/route.ts': {
    reason: 'only a group registration goes on to the event check',
    refusesWithoutQuery: 'the participant holds no role: the staff check answers before any read',
    honey: { type: 'group' },
  },
// C20 (S5 wave 9): the scholarship routes are tenant_crew. Deciding stays admin-only, so the
// Staff persona stops at the capability, on every route but the refund quote (portal:read).
  'app/api/admin/scholarships/[id]/route.ts': {
    reason: 'Staff cannot reach the application: the scholarship decision is admin-only',
    refusesWithoutQuery: 'the participant holds no role: the scholarships:write capability check answers before any read',
    crewUnproven: { stellr_staff: STAFF_NO_SCHOLARSHIPS },
  },
  'app/api/admin/scholarships/[id]/cancel/route.ts': {
    reason: 'Staff cannot reach the application: the scholarship decision is admin-only',
    refusesWithoutQuery: 'the participant holds no role: the scholarships:write capability check answers before any read',
    crewUnproven: { stellr_staff: STAFF_NO_SCHOLARSHIPS },
  },
  'app/api/admin/scholarships/[id]/not-offered/route.ts': {
    reason: 'Staff cannot reach the application: the scholarship decision is admin-only',
    refusesWithoutQuery: 'the participant holds no role: the scholarships:write capability check answers before any read',
    crewUnproven: { stellr_staff: STAFF_NO_SCHOLARSHIPS },
  },
  'app/api/admin/scholarships/[id]/refund/route.ts': {
    reason: 'Staff cannot reach the application: the scholarship decision is admin-only',
    refusesWithoutQuery: 'the participant holds no role: the scholarships:write capability check answers before any read',
    crewUnproven: { stellr_staff: STAFF_NO_SCHOLARSHIPS },
  },
  'app/api/admin/scholarships/[id]/resend/route.ts': {
    reason: 'Staff cannot reach the application: the scholarship decision is admin-only',
    refusesWithoutQuery: 'the participant holds no role: the scholarships:write capability check answers before any read',
    crewUnproven: { stellr_staff: STAFF_NO_SCHOLARSHIPS },
  },
  'app/api/admin/scholarships/[id]/offer/route.ts': {
    reason: 'percent must be a scholarship level, checked before the application is read; and Staff cannot reach it',
    refusesWithoutQuery: 'the participant holds no role: the scholarships:write capability check answers before any read',
    body: { percent: 50, sendEmails: false },
    crewUnproven: { stellr_staff: STAFF_NO_SCHOLARSHIPS },
  },
  // Staff holds schools:write, so the stellr_staff persona gets past the guard; without a
  // field to update it then stopped at 400 before the id was used.
  'app/api/admin/schools/[id]/route.ts': {
    reason: 'PATCH needs a field to update: an empty body stops at "No fields to update" before the id is used',
    refusesWithoutQuery: 'the participant holds no role: the schools:write capability check answers before any read',
    body: { name: 'IDOR harness school' },
  },
  'app/api/credentials/[number]/events/route.ts': {
    reason: 'kind is an allow-list of share events',
    body: { kind: 'copy_link' },
  },
  'app/api/credentials/[number]/visibility/route.ts': {
    reason: 'visibility must be public or private',
    body: { visibility: 'private' },
  },
  'app/api/members/deletion-requests/route.ts': {
    reason: 'entity must be one a member can request',
    body: { entity: 'event_participation' },
  },

  // ── caller-owned twin rows: the route reads the caller's row first ─────────
  'app/api/members/compliance/document/route.ts': {
    reason: 'the route needs the caller to hold a licence row before it looks at the path',
    refusesWithoutQuery: 'the storage path must start with the caller’s member id',
    methods: ['POST'],
    callerRows: {
      member_teacher_licenses: [
        { id: '00000000-0000-4000-8000-00000000a002', member_id: '00000000-0000-4000-8000-00000000a001', document_path: null },
      ],
    },
  },

  // ── lead capture: the email is the input under test, not the other fields ──
  'app/api/asset-request/route.ts': {
    reason: 'asset is a static key and the download link needs a signing secret',
    body: { asset: 'space-rfp-2026' },
    env: SIGNING_ENV,
  },
  'app/api/white-paper/route.ts': {
    reason: 'the download link needs a signing secret',
    env: SIGNING_ENV,
  },
  'app/api/lp-lead/route.ts': {
    reason: 'role, consent and students have fixed shapes; pageSlug is a static page key, not a tenant record',
    body: { role: 'teacher', consent: true, students: 10, audience: 'teachers' },
    inputs: { pageSlug: 'first-robotics-teachers' },
  },
  'app/api/cq-lead/route.ts': {
    reason: 'every field has a fixed shape; pageSlug is a static page key, not a tenant record',
    body: {
      firstName: 'Idor', lastName: 'Case', school: 'Idor High', subject: 'Physics',
      studentsBand: '1-25', theme: 'space', grantInterest: false, consent: true,
    },
    inputs: { pageSlug: 'mncose26' },
  },
  'app/api/teacher-grant/route.ts': {
    reason: 'every answer is validated by shape',
    body: {
      yearsTeaching: '5',
      priorStellr: 'no',
      firstName: 'Idor',
      lastName: 'Harness',
      schoolName: 'IDOR Harness School',
      schoolCity: 'Denver',
      schoolState: 'CO',
      subjects: 'Science',
      dateOfBirth: '1980-01-01',
      gender: 'Other',
      plannedActivities: 'challenge',
      expectedStudents: '25',
      motivation: 'IDOR harness motivation text, long enough to pass the forty character minimum.',
      consent: true,
      acknowledgePayment: true,
      website: '',
    },
  },

  // ── unconfigured integrations: dummy env, so the id reaches the check ──────
  'app/api/webhooks/apollo/route.ts': {
    reason: 'APOLLO_WEBHOOK_SECRET unset answers 503 before the signature check',
    refusesWithoutQuery: 'the signature check, which comes before the event is read',
    env: { APOLLO_WEBHOOK_SECRET: DUMMY_SECRET },
  },
  'app/api/registrations/[id]/spreadsheet/route.ts': {
    reason: 'Google env is checked before auth, and a non-group row stops before the ownership check',
    honey: { type: 'group' },
    env: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'idor-harness@example.invalid',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: DUMMY_SECRET,
    },
  },
  'app/api/community/coaching/topup/route.ts': {
    reason: 'Stripe unset answers 503 before checkout',
    ...STRIPE_CHECKOUT,
  },
  'app/api/store/reship/route.ts': {
    reason: 'Stripe unset answers 503 before the order is read',
    ...STRIPE_CHECKOUT,
  },
  'app/api/subscribe/route.ts': {
    reason:
      "HubSpot answering 503 made a 502 before any answer; source 'event-notify' sends eventSlug on. With no Sanity client the slug stays unresolved, so this proves only that the caller's own slug is passed along",
    body: { source: 'event-notify' },
    env: { HUBSPOT_FORM_EVENT_NOTIFY: 'idor-harness-form' },
    fetch: hubspotForms,
  },

  // ── host B's event: the registration reaches the route's own event check ───
  'app/api/register/individual/route.ts': {
    reason:
      "host B's event answers its slug, so the event check decides; the offer link is left out (an offer is a second record, which the tenant-host suite's offer variant tests, and a Canary value fails the link's format first)",
    event: true,
    body: { ...REGISTRANT },
    omitInputs: ['scholarship_token'],
  },
  'app/api/register/group/route.ts': {
    reason: "a group needs an organiser object, a student count and the school terms before host B's event is looked up",
    event: true,
    body: GROUP_REGISTRATION_BODY,
  },

  // ── harmless writes, accepted in the snapshot with a reason ────────────────
  // Formerly held back as C4-F1, C4-F2 and C4-F3, until B9 kept community on Stellr.
  'app/api/community/flag/route.ts': {
    reason: `contentType is a zod enum, and only a published post in a live Space goes on to the access check; ${B9_COMMUNITY}`,
    honey: CANARY_OPEN_SPACE_POST,
    body: { contentType: 'post' },
    writes: ['community_flags'],
    refusedWhen: { access_type: 'private' },
  },
  'app/api/community/reactions/route.ts': {
    reason: `targetType is a zod enum, and only a published post in a live Space goes on to the access check; ${B9_COMMUNITY}`,
    honey: CANARY_OPEN_SPACE_POST,
    body: { targetType: 'post' },
    writes: ['community_reactions'],
    refusedWhen: { access_type: 'private' },
  },
  'app/api/community/mentoring/register/route.ts': {
    reason: `Stripe unset answers 503 on the paid path, after the cohort is read; ${B9_COMMUNITY}`,
    ...STRIPE_CHECKOUT,
    writes: ['stripe.checkout.sessions.create'],
    refusedWhen: { lifecycle: 'archived' },
  },
  // Formerly held back as C4-F6. public.schools is the tenantless school directory.
  'app/api/members/onboarding/route.ts': {
    reason:
      "the date of birth, role and contact fields are validated before school_id is used; the caller's own agreement is on file, so the case tests the school link and not the signing-failure alert",
    callerRows: CALLER_AGREEMENT_ON_FILE,
    body: {
      event_role: 'teacher',
      age_bracket: 'adult',
      date_of_birth: '1980-01-01',
      gender: 'prefer_not_to_say',
      phone: '5550100',
      grade: '10',
      tshirt_size: 'M',
      ec_first_name: 'Idor',
      ec_last_name: 'Contact',
      ec_phone: '5550101',
      ec_relationship: 'Parent',
    },
    writes: ['member_schools'],
  },
}

/**
 * A fixture that gets the Canary id through to a write. Not an accepted outcome:
 * the snapshot keeps the route as it was (`unexercised` or `error`), and
 * test/idor/idor-routes.test.ts proves the write still happens. When the route is
 * fixed that test fails: move the fixture to CASE_FIXTURES and run
 * `npm run idor:snapshot`.
 */
export interface HeldBackFixture {
  method: string
  /** The entry in the maintainer's private tracker: its owner and fix. */
  ref: string
  /** Where the Canary value lands (honey-db table, or the Stripe call). */
  writes: string[]
  fixture: CaseFixture
  /**
   * Set when the route has a rule of its own and the case stays held back: the honey
   * columns that make that rule refuse. idor-routes.test.ts proves the same case then
   * comes back `refused`, so the rule is pinned apart from the held-back outcome.
   */
  refusedWhen?: Record<string, unknown>
}

export const HELD_BACK_FIXTURES: Record<string, HeldBackFixture> = {
  // Still held. The route already orders only an active variant of an active product
  // (pinned in its route.test.ts). The honey row is both, and the catalogue has no
  // tenant column, so no check can tell it from a real one until the owner decides
  // whether the catalogue gets a tenant or this outcome is accepted with a reason
  // (docs/S5-DECISION-BACKFILL-DRAFT.md BF-33, open).
  'app/api/store/checkout/route.ts': {
    method: 'POST',
    ref: 'C4-F5',
    writes: ['store_order_items'],
    fixture: { reason: 'Stripe unset answers 503 before the variants are read', ...STRIPE_CHECKOUT },
  },
}

/** The fixture a route's case runs with, for this method. */
export function fixtureFor(fixture: CaseFixture | undefined, method: string): CaseFixture | undefined {
  if (!fixture) return undefined
  return !fixture.methods || fixture.methods.includes(method) ? fixture : undefined
}

/** Sets dummy env, returning the function that puts the previous values back. */
export function applyEnv(env: Record<string, string> | undefined): () => void {
  if (!env) return () => {}
  const previous = Object.keys(env).map((k) => [k, process.env[k]] as const)
  Object.assign(process.env, env)
  return () => {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}
