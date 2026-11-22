# Handover: award namesakes off public credentials — 2026-11-22

Slug `award-public-names`. Tracker: `tracker/2026-11-22-award-public-names.md`.

## What was asked

Remove the names of the people two awards honour, Anita Gale and Dick Edwards,
from every public credential, including the LinkedIn sharing. This works the
way awards already do: the full name on the certificate, a short name in
public. The change should also apply to students who already hold these
awards.

Owner decisions (21 Nov 2026, in chat):

1. Public name = the website's short name: **Creative Vision Award** and
   **Quiet Leadership Award**.
2. Norm Chaffee keeps his name on credentials.
3. Full names stay on the certificate PDF, the admin screens and the winner's
   (or guardian's) emails.
4. Existing credentials: change at display time only. No stored row is
   rewritten and there's no migration.
5. LinkedIn entries a holder already added: nothing extra (no notice, no email).
6. Change the share card's `og:image` URL so unfurlers fetch the renamed card.

## What shipped

- **#847** → `dev` `08213c9f`; **promoted** in #848 as `51054083`
  (production `dpl_7ZqZQcgqhQPuLnBSe1BRAsTqRVh9`, rollback target
  `dpl_AiSe7FFunWw8h6gXttKp7WMEeRos`). Record and sync in #850 (`d780dc0f`),
  `.claude/releases/promote-2026-11-21b.md`.
  - `lib/event-awards.ts`: `PUBLIC_AWARD_NAMES` (now the one source for
    `/competitions` too), `PUBLIC_NAME_AWARD_TYPES = ['anita_gale',
    'dick_edwards']`, `credentialAwardLabel()`, and
    `relabelIssuedAward(row, 'public' | 'certificate')`. `public` is the
    default, so every existing display read (page, meta, OG card, wallet,
    LinkedIn links) picks up the short name with no other change.
  - Issuance (`lib/event-award-issue.ts`) stores the short name in `award` and
    `title` from now on.
  - `lib/credential-pdf.ts` (plain fallback design) and
    `lib/credentials-notify.ts` (issued and made-private emails) use
    `'certificate'`, so they keep the full name. Uploaded artwork already
    carries it.
  - The `opengraph-image.tsx` edit changes the og:image content hash
    (`?45eafdbd…` → `?bf1e8009…`), verified locally under Turbopack and live
    on production.
- **#853** → `dev` `7b92b616`, **not promoted** (the owner is promoting it
  separately). It regenerates `e2e/tenancy/stellr-document-head.json`, so
  `stellr-document.spec.ts` compares page bodies again. The old capture's
  `sourcesSha` matched no tree, so it had silently skipped the body comparison
  for every PR. All 14 differences trace to #833, #783 and #821. Test data
  only.

## Verified

- Full unit suite on #847: 786 files, 14,856 tests. CI on #847, #848 and #853
  all green, with the test steps checked as run.
- Local dev against the dev DB: the three seed credentials stored with the full
  names render only the short names, and neither person's name appears in the
  HTML.
- Production after #848: `www` 200, `app` 307 to `/sign-in`, cron guard 401,
  `/competitions` shows the four short names, credential `og:image` carries
  the new hash.

## Not verified

- **A real public Creative Vision or Quiet Leadership credential on
  production.** Production DB reads are blocked for agents, so it's unknown how
  many exist or were added to LinkedIn. The display path is the same one
  tested on dev.
- **The certificate PDF's plain fallback design and the two emails** were
  checked by unit tests of the relabel only, not by rendering a PDF or sending
  an email.
- `npm run db:status -- --prod` was not run (no `PROD_DATABASE_URL` locally).
  The promotion had no migrations.

## Known side effects

- **The admin issued-credentials list** (`app/api/admin/events/[slug]/credentials`)
  shows each credential's stored `title`. Rows issued before 21 Nov show the
  full name, and rows issued after it show the short name. See row
  `award-public-names.3`.
- **LinkedIn entries already added** keep their original name text, by
  decision 5. The page and card they link to show the short name.
- **Worktree sweeps** in this session removed two other sessions' merged, clean
  worktrees (`stellr-web-enf-fixtures`, `stellr-web-p7-verdict`), as designed.
  A `pkill -f "next dev"` here may also have stopped a dev server in
  `stellr-web-next-bump`.
- The main checkout's `node_modules` holds Next 16.4.2 against
  `package.json`'s ^16.4.5. `npm ci` there fixes it.

## Open items

See the tracker file. In short: promote #853 (`.1`); confirm on production
once someone can sign in or read the DB (`.2`); decide what the admin list
should show (`.3`); the capture goes stale on the next app-code merge (`.4`).
