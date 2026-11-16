# Claude Design sync of the design system — 2026-11-11

Slug: `claude-design-sync`. Handover: `HANDOVER-claude-design-sync-2026-11-11.md`. Doc snapshot: `1G7tEsBnwVJAt8xkyRzu4eu_nzlA1O4cHDvgo-l8MPd0`.
PR #615 → `dev` as `7bfeb941`; not yet promoted (a separate session is promoting). PR #616 → `dev` as `65418f18`. Migration: none.

Stellr Design System V2 is live in the Claude Design project "Stellr Design System" (29 components, all stories graded `match`, sync anchor uploaded). #615 splits the web-ui stories to one Storybook title per component and adds `.design-sync/`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| claude-design-sync.1 | Promote #615 to `main` | On `dev` as `7bfeb941`; `git merge-base --is-ancestor 7bfeb941 origin/main` false on 11 Nov. Stories and `.design-sync/` only, so no app runtime change | Confirm it is in the promotion record from the separate promote session | ☐ |
| claude-design-sync.2 | Hero responsive layouts verified per breakpoint | Not verified: the Desktop, Tablet and Mobile stories' viewport parameter isn't applied by either compare capture, so all three were graded at 900px | On the next sync, capture Hero at 375 and 1280 (`cfg.overrides.Hero.viewport`, or an owned preview per width) and grade | ☐ |
| claude-design-sync.3 | Design agent builds on-brand pages | Not verified: no design built in Claude Design yet. The conventions header names only classes and tokens checked against the compiled CSS | Build one page in the project (e.g. a competitions landing section) and check it uses the library components and token classes, with no raw hex or system fonts | ☐ |
| claude-design-sync.4 | Standalone Claude Design closes by 14 Dec 2026 and moves into Claude | Reviewed 15 Nov: nothing in the sites, build or CI calls Claude Design, so there is no runtime impact. The synced project is a copy built from the repo, so losing it loses no data. After a move, `/design-sync` refuses uploads to it. Move status not checked yet | Before 14 Dec, run `/design-sync` to read the project's move `notice`; record where it lives and whether syncs continue in `.design-sync/NOTES.md` ("Claude Design shutdown"). If they cannot, mark `.design-sync/` retired | ☐ |
| claude-design-sync.5 | Claude Design project populated and anchored | 158 files plus `_ds_sync.json` uploaded; `list_files` matched the final build exactly; driver receipt `ok`, 29 carried forward, render check 29/29 | — | ☑ |
| claude-design-sync.6 | `osv-scanner` red on node-forge 1.4.2 | #616 merged as `65418f18`, osv-scanner, verify and e2e passed. #617 (another session) made the same bump | — | ☑ |
| claude-design-sync.7 | Design work that exists only in Claude Design is saved before 14 Dec | Old-account designs and design chats were exported on 10 Nov and are held privately (see `account-migration.3`). Anything made in Claude Design on the new account since 10 Nov has no export | Owner: export any new-account Claude Design work; confirm the 10 Nov design export is inside the encrypted archive (the private handover says files added later need a second archive) | ☐ |
