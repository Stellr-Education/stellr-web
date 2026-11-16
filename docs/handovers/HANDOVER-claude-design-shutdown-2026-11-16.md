# Handover: Claude Design shutdown and the move to a Design System artifact (15–16 Nov 2026)

Slug: `claude-design-shutdown`. Tracker: `tracker/2026-11-16-claude-design-shutdown.md`.
Nothing here is promoted: #732 and #746 are on `dev`, not on `main`. Both are
docs and tooling only, so they ride the next promotion.

## Context
Standalone Claude Design (claude.ai/design) closes by 14 Dec 2026 and moves into
Claude. The owner asked what had to happen to avoid data loss and operational
impact, then asked to migrate the "Stellr Design System" project out of it.

## What changed
- **Review (15 Nov).** Nothing in the sites, the build or CI calls Claude
  Design. Tokens, `@stellr/web-ui`, `@stellr/icons` and Storybook are in the
  repo. The synced project was a copy. The real risk was design work that exists
  only in Claude Design, and the `/design-sync` path. Recorded in #732
  (`0dde1c3a`): `.design-sync/NOTES.md` shutdown section, rows
  `claude-design-sync.4` and `.7`, `account-migration.3`, a `CLAUDE.md` note.
- **Move check (16 Nov).** `get_project` on the old project returned no
  `moveState`; it was still in standalone Claude Design and writable. It was the
  only design-system project on the account.
- **Migration (16 Nov).** Built the Claude Design System artifact
  "Stellr Design System" (https://claude.ai/artifact/5M33PXBayD6Cr8eXTnbNCh,
  private to the owner) from `dev@b49831db`: 30 components (Collapsible is new
  since the 10 Nov sync), 57 colour tokens and 8 type styles under the
  `styles/tokens.css` names, radii, spacing, shadows, focus ring, the Norwester
  and Aileron files, four logo uploads, React 19.3.1 in `components/lib/`, a
  brand README and a cover. Marked `"editing": "code"`, so the page is
  read-only. Built by the old converter against a fresh Storybook build, then
  mapped by a script.
- **Recorded (16 Nov).** #746 (`cfbbd918`): the script
  (`.design-sync/tools/to-design-system-artifact.py`), the render check
  (`.design-sync/tools/artifact-render-check.mjs`), the hand-written sources
  (`.design-sync/artifact/`) and the rebuild steps (`.design-sync/NOTES.md`,
  "Design System artifact"). Re-running the script reproduced every published
  file byte for byte, the index excepted.

## Verified
- All 30 previews and the cover rendered headless with the brand fonts and no
  errors, loading what the artifact frame preloads.
- The published index and cover were read back from the server unchanged.
- CI green on #732 and #746 (unit, PII lint, both Playwright suites).

## Not verified
- **The live artifact page.** The browser pane was not signed in to claude.ai,
  so the page itself, its token views and the React 19 library wiring in the
  real frame are unseen (`claude-design-sync.8`).
- **Hero breakpoints** (all four stories render at one width) and **card
  heights** for tall previews, which were set by estimate.

## Open items
- `claude-design-sync.8`: owner views the live artifact.
- `claude-design-sync.7`: owner exports Claude Design work made since 10 Nov
  and confirms the 10 Nov export is in the encrypted archive.
- `account-migration.3`: public-safe design handoffs into the repo after a
  personal-data read.
- `claude-design-shutdown.4`: `components/member/OnboardingForm.graduation-year.test.tsx`
  is flaky: it failed on #746 and #748 (both docs-only) and passed on `dev`.

## Process notes
- This session edited another session's tracker files (`claude-design-sync`
  rows `.4`, `.7`, `.8`; `account-migration.3`) in #732 and #746, which the
  close-out rules forbid. The rows are accurate, and `## Closes` in this
  session's tracker lists `.4`. Future sessions should list such rows in their own
  tracker file instead of editing another session's.
- The `DesignSync` tool was used for two reads (`get_project`,
  `list_projects`) and one `list_files` outside the `/design-sync` skill, which
  this account does not list. Nothing was written to the old project.
