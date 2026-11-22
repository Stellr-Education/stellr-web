# Award namesakes off public credentials — 2026-11-22

Slug: `award-public-names`. Handover: `HANDOVER-award-public-names-2026-11-22.md`. Doc snapshot: `16iNUDGbPeA-jA3WRMSt6P7PMDddzTS7kb3MjKZ2t56k`.
PR #847 → `dev` as `08213c9f`; promoted in #848 (`51054083`). PR #853 → `dev` as `7b92b616`, not promoted. Migration: none.

Public credentials, their share card, the wallet and the LinkedIn links say "Creative Vision Award" and "Quiet Leadership Award" instead of the Anita Gale and Dick Edwards names, including credentials issued before the change. The certificate, admin award screens and winner emails keep the full names.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| award-public-names.1 | Promote #853 (stellr-document head capture regenerated) | On `dev` as `7b92b616`; test data only, no runtime change. The owner is promoting it separately | Carried by the next promotion | ☐ |
| award-public-names.2 | Confirm on production with a real award credential | Not done: production DB reads are blocked, so nobody has checked whether any live Creative Vision or Quiet Leadership credential exists or was added to LinkedIn. Display path verified on dev with seed credentials stored under the full names | Owner or a production-read role opens one public award credential page and its LinkedIn "Add to profile" link, and checks only the short name shows | ☐ |
| award-public-names.3 | Admin issued-credentials list shows mixed names | `app/api/admin/events/[slug]/credentials` returns stored `title`: rows before 21 Nov have the full name, rows after have the short name | Owner decides; if full names are wanted there, map rows through `relabelIssuedAward(row, 'certificate')` in that route | ☐ |
| award-public-names.4 | Body comparison in `stellr-document.spec.ts` lapses on the next app-code merge | Capture `sourcesSha` matches `dev` `7b92b616` only; the first merge that touches `app/`, `components/`, `lib/`, `packages/` or `styles/` turns the body comparison off again (the test still passes) | Retake when bodies matter: `node e2e/tenancy/build-harness.mjs` (no `.env` files), then `E2E_DOCUMENT_CAPTURE=head npx playwright test -c playwright.tenant-hosts.config.ts stellr-document` | ☐ |
| award-public-names.5 | Certificate PDF fallback and winner emails keep the full name | Unit tests cover `relabelIssuedAward(…, 'certificate')`; no PDF rendered and no email sent in this session | Next real award issue: check the guardian email and the downloaded certificate name the award in full | ☐ |
| award-public-names.6 | Public credentials use the short names | Live on production since 22 Nov 00:04Z (#848); `/competitions` and the og:image hash checked on production; relabel verified on dev | — | ☑ |
