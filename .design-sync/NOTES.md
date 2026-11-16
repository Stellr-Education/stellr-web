# design-sync notes — Stellr Design System → Claude Design

Project: "Stellr Design System" (`projectId` in `config.json`). Shape: storybook
(root `.storybook/`). Package: `@stellr/web-ui` (TS source, no dist — the
converter bundles `packages/web-ui/src/index.ts` directly with esbuild).

## Claude Design shutdown (standalone closes by 14 Dec 2026)
Standalone Claude Design (claude.ai/design) closes by 14 Dec 2026 and moves into
Claude. Once a project has moved, the sync tool refuses uploads to it.

- **No runtime impact.** The sites, the build and CI never call Claude Design.
  Tokens (`design/tokens.json`), `@stellr/web-ui`, `@stellr/icons` and Storybook
  are in the repo and remain the source of truth.
- **Migrated 16 Nov 2026.** The design system now lives in a Claude Design
  System artifact, "Stellr Design System",
  https://claude.ai/artifact/5M33PXBayD6Cr8eXTnbNCh (private to the owner until
  shared), built from `dev@b49831db`. See "Design System artifact" below.
- **The old project** (`projectId` in `config.json`) is redundant. On 16 Nov it
  had not moved (`get_project` returned no `moveState`). Leave it to close with
  standalone Claude Design; nothing reads it. `config.json` still names it only
  because the converter reads that file for its other settings.
- **Design files that exist only in Claude Design** (handoffs, not this project)
  are covered by tracker rows `account-migration.3` and `claude-design-sync.7`.

## Design System artifact
The artifact is a Design System type artifact kept in files under `project/`,
marked `"editing": "code"`, so its page is read-only: change the repo, then
rebuild and republish. It holds 30 components (live previews, README, types),
`tokens.json` (the `styles/tokens.css` names: 57 colours, 8 type styles, radii,
spacing, shadows, focus ring), the Norwester and Aileron files (Space Grotesk and
Hanken Grotesk load from Google Fonts), four logo uploads, React 19.3.1 in
`components/lib/`, and a cover.

Rebuild:
1. `npm run build:tokens`, then a Storybook build to a scratch folder.
2. The converter (`.ds-sync/package-build.mjs`, see Setup) with
   `--storybook-static <that folder> --out <conv-out>`.
3. `python3 -I .design-sync/tools/to-design-system-artifact.py <checkout> <conv-out> <dest> <timestamp> <branch@sha>`.
   It maps the converter output into `project/` and copies the hand-written
   sources in `.design-sync/artifact/` (brand README, cover, logo notes): edit
   those here, not on the page.
4. Render-check: `node .design-sync/tools/artifact-render-check.mjs <dest>/project <png-dir>`
   (run from `.ds-sync/` so it finds playwright). Dialog and ConfirmDialog show
   0 grid cells by design: they mount full-frame.
5. Publish `<dest>/project/` to the artifact url with the Artifact tool. Send
   `.d.ts` files with `contentType: text/plain`. Read `project/design-system.json`
   back first and keep its keys (title, logo `assetGroups` with their blob ids,
   `createdOnFiles`); send it last, with a new `lastChange`.

Not verified on 16 Nov: the live page (checked by headless render and a
read-back of the published files only), Hero breakpoints (all four stories
render at one width), and card heights for tall previews.

## Setup (fresh clone)
- Converter deps live in `.ds-sync/` (gitignored): stage the skill scripts, then
  `(cd .ds-sync && npm i esbuild ts-morph @types/react playwright && npx playwright install chromium)`.
- Reference storybook: `npx --no-install storybook build -c .storybook -o "$(git rev-parse --show-toplevel)/.design-sync/sb-reference"`.
  Rebuild it whenever stories or `packages/web-ui` change.
- `--node-modules ./node_modules` (repo root; npm workspaces symlink
  `@stellr/web-ui` and `@stellr/icons` there).

## Decisions + fixes
- [GENERAL] One Claude Design component per Storybook title. The web-ui story
  files used to group families under one title (Primitives, Competition,
  Forms/Primitives, Foundations/Tier Shading, Guarantee) → only 7 components got
  cards. Fix (owner's choice, 10 Nov 2026): split them in the repo into
  per-component titles (`Primitives/Button`, `Competition/TierCard`,
  `Forms/Field`, …), JSX moved unchanged; added small stories for components
  that had none (CtaBand, InfoPill, Input, Select, Textarea, Choice, Fieldset,
  ConfirmDialog split out of Overlays/Dialog). New web-ui components need a
  `<Group>/<ExportName>` story to get a card.
- App screens excluded (owner's choice): `Chrome/AppSidebar`,
  `Admin/Event team profiles`, `Team profile/Form` → `titleMap: null`. They need
  Next.js routing/app data and aren't DS parts.
- Media sections (`components/sections/*`: AudioTestimonial, ProofStrip,
  PullQuoteWall, VideoTestimonial, WorkCard) ship via
  `.design-sync/entries/media.ts` in `extraEntries`; `tsconfig: ../../tsconfig.json`
  resolves their `@/lib/...` imports.
- [GENERAL] Fonts: Space Grotesk + Hanken Grotesk come from `next/font` in the
  app (`lib/fonts.ts`), which sets `--font-space-grotesk` / `--font-hanken-grotesk`
  on `<html>`. No bundle can carry next/font, and the compiled CSS uses
  `var(--font-…)` with no fallback → undefined var makes the whole
  font-family invalid → browser default font. Fix:
  `.design-sync/fonts/brand-fonts.css` (`extraFonts`: @font-face to the same
  gstatic latin variable woff2 files Storybook's next/font loader serves) +
  `.design-sync/entries/font-vars.ts` (`extraEntries`: injects
  `:root{--font-space-grotesk:'Space Grotesk';--font-hanken-grotesk:'Hanken Grotesk'}`
  at bundle load).
- CSS: no package stylesheet; `[CSS_FROM_STORYBOOK]` scrapes the compiled
  Tailwind 4 + tokens CSS from the reference build — expected. Norwester/Aileron
  (competition print faces) ride along from `public/fonts/`.
- [GENERAL] `lib/media-helpers.ts` reads `process.env` at module load → every
  preview died with `ReferenceError: process is not defined` and the whole
  bundle exported nothing (`[BUNDLE_EXPORT]` 29/29). Fix:
  `.design-sync/entries/process-env.ts`, listed FIRST in `extraEntries` so it
  evaluates before media-helpers; sets `NODE_ENV=production` and
  `NEXT_PUBLIC_MEDIA_BASE_URL` to the public `stellr-media` Blob store (the same
  value Storybook inlines from `.env`).
- Card overrides: `Dialog` / `ConfirmDialog` → `cardMode: single` (fixed
  overlays); `PullQuoteWall` → `cardMode: column` (`[GRID_OVERFLOW] wide`);
  `TierCard` → `viewport: 1000x700` (its Tier Cards row of four 200px-min cards
  + p-8 is exactly 900px, so the preview frame's padding wrapped the 4th card).
- [GENERAL] Grading overlays: compare's storybook shot crops to body height, so
  fixed-position dialogs show only the backdrop on the reference side. Grade
  against a full-viewport shot: `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`
  once, then `node .design-sync/tools/sbshot.mjs .design-sync/sb-reference <outdir> <story-id>...`.
- Framing (not defects): the preview page pads ~24px and captures at a fixed
  900x700, so tall stories (ThemeCard, PathwayCard, BracketShadeKey, ProofStrip
  Four Up) clip at the bottom on the preview side, and the storybook side shows
  the `surface` canvas background. Graded on the visible area.
- Known validate warns, triaged: `[TOKENS_MISSING]` `--font-*-grotesk` (set at
  runtime by font-vars.ts), `--sheet-top` / `--ring-c` / `--ring-target` (set
  inline by Dialog/TierCard). `[CSS_ASSETS]` for the competition .otf files is
  handled by font extraction.

## First sync result (10 Nov 2026)
29/29 components graded `match` (all stories), 0 `close`, 0 skipped. Final
receipt: driver `ok`, 29 carried forward, full render check 29/29 clean.

## Re-sync risks
- `process-env.ts` hard-codes the media Blob URL. If `NEXT_PUBLIC_MEDIA_BASE_URL`
  changes in `.env`, update it there too or media images 404 in designs.
- `brand-fonts.css` pins Google Fonts gstatic URLs (spacegrotesk v22,
  hankengrotesk v12, latin subset only). Google can retire versioned URLs, so
  re-copy them from the sb-reference bundle if fonts fall back. Designs load them
  over the network at runtime.
- `font-vars.ts` mirrors the var names in `lib/fonts.ts`. Renaming them there
  silently breaks every design's type.
- Hero's Desktop/Tablet/Mobile stories set a Storybook viewport that neither
  capture applies, so responsive Hero layouts were not verified per breakpoint.
- The three app screens are excluded by `titleMap: null` on title tails
  (`AppSidebar`, `Eventteamprofiles`, `Form`). A new DS story whose title ends
  in `/Form` would be excluded too.
- The CSS is scraped from the reference Storybook build. Rebuild sb-reference
  after any Tailwind/token change, or designs get stale CSS.
