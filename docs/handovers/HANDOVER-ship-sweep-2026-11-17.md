# Handover — ship sweep and promotion #792 (17 Nov 2026)

Slug: `ship-sweep`. Tracker: `tracker/2026-11-17-ship-sweep.md`.

## Context

The session started with a question: a recent promotion should have given the owner a way to get a receipt for a teacher (educator `06191e52-9f57-4c5a-8391-776eda22f385`; name in the Doc). It hadn't. The receipt work was #777, which was green but never merged into `dev`.

The owner then asked for every Code session since the account switch (10–11 Nov) to be reviewed, and for anything built but not merged to be shipped to `dev` at once. The single-instance multi-tenant (S5) work was excluded because it is on hold. The owner then approved promoting the result.

## What changed

**Merged into `dev` (squash):**

| PR | Change | SHA |
|---|---|---|
| #750 | Graduation-year onboarding test flake fix | `722d9389` |
| #776 | Event-email sends stop cleanly and continue; DocuSign once; honest History | `f94adb2d` |
| #777 | Payments: invoices and receipts for payers, staff and event managers | `8b40de57` |

**Promoted:** #792 merged to `main` as `059a1280`. Production deployment `dpl_HPswTKjoPhN8pTEdUMT1A721UNxs`. Rollback target `dpl_BV3LXmV1xbSMVrGq3fyYFitvaPZ3` (`21f939e8`). No migrations, no new environment variables, no cron changes. Record and `dev` sync: #794, `.claude/releases/promote-2026-11-17b.md`.

**Verified:** CI step outcomes for each PR and for #792's head (typecheck, build, unit tests, both Playwright runs). After the deploy:
- the Vercel status succeeded on `059a1280`;
- www returned 200, and app returned 307 to `/sign-in`;
- the cron guard returned Unauthorized;
- both new routes returned 401 when signed out.

## Not shipped, on purpose

- **S5 (on hold):** #759, #764, #766, #767; the local `s5/*` branches; `chore/b10r-red-proof`.
- **Event add-ons stack:** #782, #783, #785, #786, #787, #789 and #790 belong to the running "Event registration add-ons scoping" session. It declined to merge on a relayed instruction and is waiting for the owner's yes there. #791 is a deliberate draft: it drops tables that production still reads, so it waits until #785 is live.
- **#760:** superseded by #762 (Next.js 16.4.5 already shipped). Its removal of the deepmerge ignore never landed, and the PR now conflicts with `dev`.

## Not verified

- **No signed-in receipt or invoice download yet.** Untested: the event roster, the admin member Payments panel, and the member Billing tab.
- **No new live card payment yet** to show Checkout creating a Stripe invoice.
- **The teacher's own place has no participant row on her member record.** Her Billing tab reads "No event participations found", so the roster is the only route to her receipt. Not checked: whether her roster row is marked paid and shows the links.

## Mistakes made in this session

- I told the owner to fetch the receipt via View as member → Billing. That was wrong: the tab has no row for her.
- I told the add-ons session its worktree had uncommitted files and an unpushed branch. That was also wrong; it was clean and pushed.
- I did not run ship Phases 1 and 4 (contract checklist and review) myself for #776 and #777. I relied on their authoring session's PR bodies and on CI.

## Open items

See the tracker: `ship-sweep.1`–`.6`.
