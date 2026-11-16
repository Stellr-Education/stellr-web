# Graduation-year test flake — 2026-11-16

Slug: `graduation-year-flake`. Handover: `HANDOVER-graduation-year-flake-2026-11-16.md`. Doc snapshot: `1LVHQOVUU_Aka9ZKjHRYhMwhsvoeVF0iy1W-AI7fywso`.
PR #750 → `dev`, not merged at close-out (held behind promotion #747); test-only, nothing to promote. Migration: none.

Fixed the intermittent failure of "a year outside the range stops the step with
the range under the field; blank does not" in
`components/member/OnboardingForm.graduation-year.test.tsx`. Cause: a Continue
with gaps moves focus to Date of birth on the next animation frame
(`check()` in `components/member/OnboardingForm.tsx`). When that frame landed
after `user.type` had clicked into the graduation-year field but before its
first key, every key went to Date of birth, the year stayed blank (valid), and
no error showed. The test now waits for that focus move before typing, as
`OnboardingForm.test.tsx` already did, and asserts the typed value. The
component is unchanged.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| graduation-year-flake.1 | Test waits for the focus move; asserts the typed year | PR #750 green, all checks; not merged, held so it does not restart promotion #747's CI | After #747 merges: check #750 is `CLEAN` (else `gh pr update-branch 750`, wait for CI), squash with `--delete-branch` from the main checkout | ☐ |
| graduation-year-flake.2 | Unrelated flake: `lib/team-profile/store.test.ts` "keeps sending Stellr's team profiles when the other tenant's write fails" timed out (>5000 ms) on #750's first CI run | Passes locally; a fix session proposed in the app, not started | Find the real-time wait in `dispatchTeamProfiles`' test path; fake timers, never a longer timeout | ☐ |

## Closes

- `claude-design-shutdown.4`: reproduced deterministically (a 50 ms pause between the click into the field and the keys left the year blank and failed with the CI error); under 14 busy-loop processes on 10 cores, the old case failed 53 of 150 repeats and the fixed case passed 150 of 150; CI green on #750. Closed in code once #750 is on `dev`.
