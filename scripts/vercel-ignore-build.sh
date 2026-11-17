#!/usr/bin/env bash
# Vercel Ignored Build Step, wired in by `ignoreCommand` in vercel.json.
#
# Exit 0 = skip this deployment. Exit 1 = build it. (Vercel's convention; yes,
# it is backwards from a test.)
#
# Both Vercel projects are linked to this one repo, and until 15 Sept 2026 every
# push to every branch built a deployment in BOTH — six deployments per PR, none
# of the previews used. Function Storage is metered on retained deployments and
# reached 75% of the Hobby limit. The rule is now:
#
#   stellr-web      (production)  builds `main` only
#   stellr-web-dev  (dev)         builds `dev`  only
#
# This script cancels a build; it does NOT stop the deployment being created,
# and a CANCELED deployment still counts toward the Hobby deployments/day limit
# (100). On 28 Sept 2026, 100 deployments in 4.4 hours hit the limit and 75 of
# them were cancelled here. So `vercel.json` also sets `git.deploymentEnabled`:
# only `main` and `dev` create deployments at all (a branch deploys if any
# matching pattern is true, so `"**": false` plus two `true`s). Feature-branch
# pushes now cost nothing. This script still matters for the two branches that
# do deploy: every `dev` push reaches the production project too, and every
# `main` push reaches the dev project, and one of each pair must be skipped.
#
# On the dev project, a `dev` push that changes only docs is skipped too (see
# below).
#
# Anything unrecognised builds, and says why, so a misconfiguration shows up as
# a stray deployment in the dashboard rather than as silence. Project IDs are in
# docs/ENV-MATRIX.md.

PROD_PROJECT_ID="prj_wMlZwzDocSUrQ5sFZMngrNBeoUvx"
DEV_PROJECT_ID="prj_Nd2kmpMj3bBuXbSjc6teUdwh9gPO"

ref="${VERCEL_GIT_COMMIT_REF:-}"
project="${VERCEL_PROJECT_ID:-}"

case "$project" in
  "$PROD_PROJECT_ID") wanted="main" ;;
  "$DEV_PROJECT_ID")  wanted="dev" ;;
  *)
    echo "vercel-ignore-build: unknown VERCEL_PROJECT_ID '${project}' — building"
    exit 1 ;;
esac

if [ -z "$ref" ]; then
  echo "vercel-ignore-build: VERCEL_GIT_COMMIT_REF is empty — building"
  exit 1
fi

if [ "$ref" != "$wanted" ]; then
  echo "vercel-ignore-build: this project builds '${wanted}' only; '${ref}' skipped"
  exit 0
fi

# Docs-only `dev` pushes are skipped on the dev project (6 Oct 2026). Every
# retained build holds ~42 MB of functions, and builds are kept for days, so they
# fill Hobby's 10 GB Function Storage. On 6 Oct the dev project held 146 builds
# and 82 of them changed nothing but docs: close-outs, handovers and promotion
# records. The rule matches CI's `changes` job (.github/workflows/ci.yml):
# `docs/`, `.claude/`, root `*.md`. Nothing at runtime reads those paths.
#
# Production is deliberately left out. A docs-only push to `main` is how a
# missing production deployment gets re-triggered (#197, 24 Sept).
#
# 17 Nov 2026: Function Storage hit 75% for the third time. The dev project held
# 87 builds from one week (about 12 a day, ~64 MB each). Two more kinds of `dev`
# push are now skipped:
#   - test/CI/tooling-only: tests (`*.test.*`, `*.spec.*`, `__tests__/`, `e2e/`,
#     `test/`), Storybook (`.storybook/`, `*.stories.*`), `.github/`, and the
#     root test/scanner configs. `next build` never reads them, and nothing under
#     app/, lib/, components/ or packages/ imports from test/ or e2e/.
#   - an empty diff: the same tree as the last real build (a record merge that
#     only re-points history). Before this it built, because `[ -n "$files" ]`
#     failed.
# Every reason to build is now logged, so a stray dev build says why.
#
# VERCEL_GIT_PREVIOUS_SHA is the last *successful* deployment on this branch.
# Skipped builds don't count as successful, so the diff covers every change since
# the last real build. Vercel's clone is shallow; if that commit is missing, the
# script tries to deepen the clone once, and builds if it still can't diff. Put
# `[build]` in the commit message to force a build.
SKIP_PATHS='^(docs/|\.claude/|\.github/|\.storybook/|e2e/|test/)'
SKIP_PATHS="${SKIP_PATHS}"'|^[^/]+\.md$'
SKIP_PATHS="${SKIP_PATHS}"'|\.(test|spec)\.(ts|tsx|js|mjs|cjs|mts)$|(^|/)__tests__/|\.stories\.(ts|tsx|mdx)$'
SKIP_PATHS="${SKIP_PATHS}"'|^(playwright[^/]*\.config\.ts|vitest[^/]*\.(config\.mts|setup\.ts)|stryker\.config\.mjs|lighthouserc\.json|osv-scanner\.toml|\.gitleaks\.toml|\.semgrepignore)$|^\.semgrep/'

if [ "$project" = "$DEV_PROJECT_ID" ]; then
  prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
  case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
    *"[build]"*)
      echo "vercel-ignore-build: [build] in the commit message — building"
      exit 1 ;;
  esac
  if [ -z "$prev" ]; then
    echo "vercel-ignore-build: no VERCEL_GIT_PREVIOUS_SHA — building"
    exit 1
  fi
  if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
    git fetch --quiet --deepen=200 2>/dev/null \
      || git fetch --quiet --depth=200 origin "$ref" 2>/dev/null || true
  fi
  if ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
    echo "vercel-ignore-build: previous build ${prev:0:7} not in the clone — building"
    exit 1
  fi
  if ! files=$(git diff --name-only --no-renames "$prev" HEAD 2>/dev/null); then
    echo "vercel-ignore-build: git diff against ${prev:0:7} failed — building"
    exit 1
  fi
  if [ -z "$files" ]; then
    echo "vercel-ignore-build: same tree as the last build (${prev:0:7}) — skipped"
    exit 0
  fi
  if ! printf '%s\n' "$files" | grep -qvE "$SKIP_PATHS"; then
    echo "vercel-ignore-build: docs/test/CI-only change since ${prev:0:7} — skipped"
    printf '%s\n' "$files" | sed 's/^/  /'
    exit 0
  fi
  echo "vercel-ignore-build: runtime files changed since ${prev:0:7}, e.g.:"
  printf '%s\n' "$files" | grep -vE "$SKIP_PATHS" | head -5 | sed 's/^/  /'
fi

echo "vercel-ignore-build: ${ref} on this project — building"
exit 1
