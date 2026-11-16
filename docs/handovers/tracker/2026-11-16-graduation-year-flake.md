# Graduation-year test flake — 2026-11-16

Slug: `graduation-year-flake`. Handover: none (one-change session; the PR body is the record). Doc snapshot: none.
PR → `dev`; not promoted (test-only, no production effect). Migration: none.

Fixed the intermittent failure of "a year outside the range stops the step with
the range under the field; blank does not" in
`components/member/OnboardingForm.graduation-year.test.tsx`. Cause: a Continue
with gaps moves focus to Date of birth on the next animation frame
(`check()` in `components/member/OnboardingForm.tsx`). When that frame landed
after `user.type` had clicked into the graduation-year field but before its
first key, every key went to Date of birth, the year stayed blank (valid), and
no error showed. The test now waits for that focus move before typing, as
`OnboardingForm.test.tsx` already did, and asserts the typed value. The
component is unchanged: the race needs a click and a keystroke inside one
16 ms frame, which a person does not do.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| graduation-year-flake.1 | Test waits for the focus move; asserts the typed year | On `dev` | none | ☑ |

## Closes

- `claude-design-shutdown.4`: reproduced deterministically (a 50 ms pause between the click into the field and the keys left the year blank and failed with the CI error); under 14 busy-loop processes on 10 cores, the old case failed 53 of 150 repeats and the fixed case passed 150 of 150; CI green on the PR.
