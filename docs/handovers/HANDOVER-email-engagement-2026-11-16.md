# Handover: Email Engagement tab and the Outstanding payments group — 16 Nov 2026

Slug: `email-engagement`. Tracker: `tracker/2026-11-16-email-engagement.md`.
PR #765 → `dev` as `fda52b70`. **Not promoted.** The owner is promoting it in
another session. Migration: none.

## What was asked

1. Rename the event's "Email Reminders" tab to "Email Engagement".
2. For the "Outstanding payments" group, a group paying by invoice should email
   only the teachers and student managers responsible for the unpaid invoice,
   never its students or parents. People paying individually should still get
   it, with their parents.

Owner answers to two questions asked during the session:
- **Teacher contact:** in a group a student manager registered, the teacher
  point of contact they named also gets the invoice reminder.
- **Organiser list:** in a group whose members pay their own way, the organiser
  also gets an email listing who still owes, by name and without their links.

## What changed

- **Rename.** The tab label, the roster's button to the tab, and code comments
  now say "Email Engagement". The tab id (`?tab=emails`) is unchanged.
  Migrations and historical docs keep the old name.
- **Recipients** (`lib/event-emails/audiences.ts` `buildRecipients`). Each
  unpaid place is decided by `lib/group-payer.ts` `payerOf()`:
  - `group`: the place is on the invoice or the organiser's card checkout. Only
    the group's contacts are emailed: whoever registered it (teacher or student
    manager) and `teacher_poc_email`. No students or parents are emailed.
  - `self`: the place is paid by its own link. The person, their
    parent/guardian (minors), and the group's contacts are emailed. The
    contacts get a `member` payment line, rendered as "Still to pay for their
    own place: A and B…".
  - `shared`: a teacher the students' shares cover. Nobody is emailed.
  - Individual registrations are unchanged.
- **The bug this fixes.** Before, any group without `member_pays_individually`
  counted as paying in one go. In "Invoice for some" and "Students share the
  teacher's cost" groups, that chased the teacher for self-payers and never
  reached the self-payers. A student manager's teacher contact was never
  reached at all.
- **Roster** (`lib/event-admin.ts`). It now reads `registrant_role`,
  `teacher_poc_*`, `late_joiner_payer`, `share_estimate`, `share_first_paid_at`
  and `participants.payer`. These columns are already in production.
- **Labels.** There is a new recipient role, "Student manager", in send history,
  and a new hint for the group in `lib/event-emails/types.ts`.
- **Tests.** There are 7 new cases in `lib/event-emails/event-emails.test.ts`.

## Verified

- On #765, CI's unit tests, Playwright suite (`e2e-tests / Run npx playwright
  test`), build, typecheck and design-token lint all passed. Unit needed one
  re-run for the known graduation-year flake (fix in #750).
- osv-scanner failed on GHSA-mfr8-8qww-v76h (`next` 16.4.2). This change
  doesn't cause it. #760 and #762 both fix it and duplicate each other.

## Not verified

- I haven't looked at the tab or a recipient preview in a browser (it needs an
  admin sign-in).
- I haven't previewed the group against a real event's roster on the dev
  database.
- No real send has gone out under the new rules.

## Open items

These are in `tracker/2026-11-16-email-engagement.md`:
- `email-engagement.1`: promote (owner, another session).
- `email-engagement.2`: preview the group on a dev event with an invoiced group.
- `email-engagement.3`: retire, or bring in line, the legacy one-click
  `/api/admin/events/[slug]/remind` route. Nothing in the UI calls it, but it
  still emails every unpaid participant and parent, invoiced groups included.
- `email-engagement.4`: the starter "Outstanding payment" email reads "We
  haven't received payment for this registration yet". To an organiser who gets
  only the "still to pay" list, that is slightly off. Consider a template line
  for organisers.
