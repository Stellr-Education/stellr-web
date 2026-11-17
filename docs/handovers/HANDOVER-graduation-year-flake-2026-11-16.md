# Handover: graduation-year test flake — 2026-11-16

Slug: `graduation-year-flake`. Tracker: `tracker/2026-11-16-graduation-year-flake.md`.
PR #750 → `dev`, **not merged at close-out**: held so it does not restart the CI
of promotion #747 (`dev` → `main`), which was open and green. Test-only, so there
is nothing to promote and no migration.

## Context

A side session, started from the Claude Design shutdown close-out, which hit
this unit-test failure twice in CI on docs-only PRs (#746 and #748, run 1 each)
and logged it as `claude-design-shutdown.4`.

## Cause

`components/member/OnboardingForm.graduation-year.test.tsx`, "a year outside the
range stops the step with the range under the field; blank does not".

A Continue with gaps runs `check()` in `components/member/OnboardingForm.tsx`.
`check()` sets the errors at once, then moves focus to the first gap (Date of
birth) on the **next animation frame**. The test typed into the graduation-year
field straight after that Continue. `user.type` clicks the field and then sends
the keys. When the pending frame landed between the click and the first key,
focus jumped to Date of birth, every digit went there, the year stayed blank
(valid), and the second Continue rightly showed no year error.

Evidence:
- Deterministic repro: a 50 ms pause between the click into the field and the
  keys left focus on Date of birth and the year `""`, and gave the CI assertion
  failure.
- Under load (14 busy-loop processes on 10 cores), the case run 150 times: old
  test 53 failed, fixed test 150 passed.

## What changed

Test only. After each Continue, the test waits for focus to reach Date of birth
before typing, as `OnboardingForm.test.tsx` already does, and asserts the typed
value lands (`toHaveValue`). No assertion was removed or loosened. The component
is unchanged: the race needs a click and a keystroke inside one ~16 ms frame
after Continue, which a person does not do.

## Verified

- `npx vitest run components/member/` locally: 6 files, 30 tests pass.
- CI on #750: all checks green on the re-run (the first run failed on an
  unrelated test, below; the graduation-year tests passed in both runs).

## Not verified / open

- **#750 is not on `dev`.** Next: once #747 has merged, check #750 is still
  `CLEAN` (if `BEHIND`, `gh pr update-branch 750` and wait for CI), then squash
  it with `--delete-branch` from the main checkout. Row `graduation-year-flake.1`.
- **A second, unrelated flake:** `lib/team-profile/store.test.ts`, "the daily
  sweep with two tenants" › "keeps sending Stellr's team profiles when the other
  tenant's write fails", went over vitest's 5000 ms timeout on #750's first CI
  run (the file took 7.5 s on the runner). It passes locally. A session to fix
  it is proposed in the app but not started. Row `graduation-year-flake.2`.
