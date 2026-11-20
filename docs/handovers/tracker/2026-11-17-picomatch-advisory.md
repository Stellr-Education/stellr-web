# picomatch advisory in osv-scanner — 2026-11-17

Slug: `picomatch-advisory`. Handover: `HANDOVER-picomatch-advisory-2026-11-17.md`. Doc snapshot: `1IXMmClArrHQseeYOoM8w9cYIHhUkuJE1Hk13VGyBDJc`.
PR #780 → `dev` as `ce49c290`; not promoted. Migration: none.

GHSA-fc5q-39xc-vjpf (picomatch ReDoS) has no fixed release on 2.x or 4.x, so `osv-scanner.toml` accepts it until 17 Feb 2027; `osv-scanner` was green on #780.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| picomatch-advisory.1 | Replace the ignore with a real fix | No fixed picomatch on 17 Nov 2026 (advisory `<= 4.0.7`). Ignore expires 2027-02-17, after which `osv-scanner` goes red again | When picomatch ships a fix (check `npm view picomatch versions` and the advisory), bump it, add an `overrides` entry where a parent pins the range (`micromatch@4.0.8` pins `picomatch@^2.3.1`), and delete the entry | ☐ |
| picomatch-advisory.2 | Reach production | On `dev` only; promotion PRs keep a red `osv-scanner` until it lands on `main` | Ships with the next `promote`; no action of its own | ☐ |
| picomatch-advisory.3 | `osv-scanner` green on the `dev` push | `security.yml` run for `ce49c290` was pending at close-out | `gh run list --workflow security.yml --branch dev --limit 3` and check the `osv-scanner` job | ☐ |
