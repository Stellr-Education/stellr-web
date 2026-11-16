# Claude Design shutdown and the move to a Design System artifact — 2026-11-16

Slug: `claude-design-shutdown`. Handover: `HANDOVER-claude-design-shutdown-2026-11-16.md`. Doc snapshot: `1ZBBm5KbPCd2AKB5TH_JxeX77Hbe2x7kw4tx0M6jIKwA`.
#732 → `dev` as `0dde1c3a`; #746 → `dev` as `cfbbd918`; neither promoted. Migration: none.

Standalone Claude Design closes by 14 Dec 2026. The design system now lives in the Claude Design System artifact "Stellr Design System", built from `dev@b49831db`, and the repo holds its build script, render check and sources.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| claude-design-shutdown.1 | Shutdown impact reviewed and recorded | No runtime dependency found (sites, build, CI); #732 merged as `0dde1c3a`, CI green | — | ☑ |
| claude-design-shutdown.2 | Design system built as a Claude Design System artifact | Published 107 files to https://claude.ai/artifact/5M33PXBayD6Cr8eXTnbNCh; 30 previews and the cover render-checked headless, clean; index and cover read back from the server. Live page not viewed (`claude-design-sync.8`) | — | ☑ |
| claude-design-shutdown.3 | Build tools and sources in the repo | #746 merged as `cfbbd918`, CI green; re-running the script reproduced every published file byte for byte (index excepted) | — | ☑ |
| claude-design-shutdown.4 | `OnboardingForm.graduation-year.test.tsx` is flaky | Failed twice in an hour on docs-only PRs (#746 run 1, #748 run 1): "a year outside the range…" saw no `aria-invalid` after Continue. `dev` passed on the same trees. The form's validation is synchronous (`OnboardingForm.tsx` ~L222), so the cause is not yet known | Reproduce under load (`vitest --repeat`), find why `fieldErrors.graduation_year` is not set, and fix the cause rather than retrying | ☐ |
| claude-design-shutdown.5 | #732 and #746 reach `main` | On `dev` only; docs and tooling, no runtime change | Confirm in the next promotion record | ☐ |

## Closes

- `claude-design-sync.4`: the design system moved to the Design System artifact above; the old project was checked with `get_project` on 16 Nov (no `moveState`) and is redundant. Recorded in #746.
