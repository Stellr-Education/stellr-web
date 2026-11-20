# Handover: picomatch advisory in osv-scanner (17 Nov 2026)

Slug: `picomatch-advisory`. Tracker: `tracker/2026-11-17-picomatch-advisory.md`.

## Context

`osv-scanner` (`security.yml`, report-only while `OSV_ENFORCE` is unset) went red on every PR once GHSA-fc5q-39xc-vjpf reached OSV. It is a ReDoS in picomatch on single-branch repeated extglobs such as `+(*)`, published 19 Oct 2026, scored 8.7 by OSV. First seen on #778, which did not touch the lockfile.

## What was found

- **No fixed release.** The advisory covers `<= 4.0.7` with no first patched version. On 17 Nov 2026 the newest releases were 2.3.2 (2.x) and 4.0.7 (4.x, `latest`). OSV's fixed-version column read `--`. A lockfile bump or `overrides` could not clear it.
- **Who pulls it** (`npm ls picomatch --package-lock-only`):
  - 2.3.2: `@next/eslint-plugin-next` → `fast-glob@3.3.1` → `micromatch@4.0.8`
  - 4.0.4: `lockfile-lint` → `tinyglobby@0.2.17`
  - 4.0.7: `vite`, `vitest`, `@rollup/pluginutils` (Storybook), `@rolldown/plugin-babel`, `@sanity/cli`, `@sanity/cli-build` (two copies)
- **Exposure.** All are build, test or CI tooling matching globs from the repo's own config. Nothing in `app/`, `lib/`, `components/`, `packages/` or `scripts/` imports a glob matcher.

## What changed

PR #780, squash-merged into `dev` as `ce49c290`:
- `osv-scanner.toml`: an `[[IgnoredVulns]]` entry for GHSA-fc5q-39xc-vjpf, `ignoreUntil = 2027-02-17`, with the reason above.
- `docs/RUNBOOK-security-scans.md`: the OSV row now says "Accepted advisories" instead of "One advisory".

CI on #780: every check green, including `osv-scanner` / "Scan package-lock.json", `unit`, and both "Run npx playwright test" steps. The first run's `unit` failure was the OnboardingForm graduation-year flake (fixed by #750, still open); a re-run of the failed jobs passed.

## Not verified

- `osv-scanner` on the `dev` push of `ce49c290` was still pending at close-out. The PR run scanned the same lockfile and config, so it should pass.
- Not promoted. `main` still has the old `osv-scanner.toml`, so a promotion PR's `osv-scanner` stays red until this reaches `main` with the next promotion.

## Open items

See the tracker file: `picomatch-advisory.1` to `.3`.
