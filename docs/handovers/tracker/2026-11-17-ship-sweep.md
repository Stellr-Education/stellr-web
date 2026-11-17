# Ship sweep and promotion #792 — 2026-11-17

Slug: `ship-sweep`. Handover: `HANDOVER-ship-sweep-2026-11-17.md`. Doc snapshot: `1vdgvXne3KXpEWl446m439vqtujaano6VAJxodRZuEo8`.
PRs #750, #776, #777 → `dev` as `722d9389`, `f94adb2d`, `8b40de57`; promoted in #792 (`059a1280`). Migration: none.

Receipts and invoices (#777) and the event-email send resume (#776) are live in production. The rest of the built-but-unmerged work is either S5 (on hold) or the add-ons stack, which is waiting for the owner's yes in its own session.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| ship-sweep.1 | Teacher's receipt and invoice (educator `06191e52-9f57-4c5a-8391-776eda22f385`) | Live code can serve it. Her Billing tab has no participation row, so only the event roster route applies. Not tried. | Admin → Events → her event → Roster → Receipt / Invoice on her paid row; send both to her | ☐ |
| ship-sweep.2 | Signed-in check of #777 in production | Routes return 401 signed out. No signed-in download from the roster or the Payments panel. | One crew download of each document from a paid roster row | ☐ |
| ship-sweep.3 | Add-ons stack #782–#790 | Built, open, waiting for the owner's yes in "Event registration add-ons scoping". #791 waits until #785 is live. | Owner answers there; that session ships in order | ☐ |
| ship-sweep.4 | deepmerge OSV ignore | #760 is superseded by #762 except for dropping the withdrawn deepmerge ignore in `osv-scanner.toml`. #760 conflicts. | Small PR from `dev` that drops the ignore if the advisory is withdrawn; close #760 | ☐ |
| ship-sweep.5 | Teacher's place not linked to her member record | Her Billing tab shows "No event participations found"; the only item is the voided group invoice. Cause not investigated. | Check her participant row's `member_id` on the dev-mirrored logic and decide whether to link it | ☐ |
| ship-sweep.6 | Record and sync PR #794 | Open, CI running at close-out. | Merge with `--merge --delete-branch` from the main checkout | ☐ |

## Closes

- `email-send-receipts.1`: #776 merged into `dev` as `f94adb2d`, after reading its CI steps.
- `email-send-receipts.2`: #777 merged into `dev` as `8b40de57`, after reading its CI steps.
- `email-send-receipts.3`: promoted in #792 (`059a1280`). Vercel status succeeded, and the new routes answer 401 in production.
- `email-send-receipts.13`: `git worktree list` no longer shows `../stellr-web-email-send` or `../stellr-web-receipts`.
- `claude-design-shutdown.4`: the flake fix #750 merged into `dev` as `722d9389` and was promoted in #792. #777's rerun on top of it passed unit tests.
