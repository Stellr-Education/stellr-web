# Handover: Classroom Qualifier website, Phases 0–2, plus two promotions (16–17 Nov 2026)

Slug `classroom-qualifier`. Tracker: `tracker/2026-11-16-classroom-qualifier.md`.

## Context

The owner's V2 handover ("Revised Plan v3", 13 Nov 2026) renames the fall and spring "Campaign" to the **Classroom Qualifier** and rebuilds its public pages around one offer: a free curriculum, gated by a teacher-only form, with the deadline in the CTA. Its fixed facts (dates, stats, grant, prize, guarantee) are used verbatim and pinned in `content/cq/facts.test.ts`. Phase 0 had to be live for the MnCOSE26 booth (20–21 Nov 2026).

## What shipped, and where it is

| Change | PR into dev | Production |
|---|---|---|
| Phase 0: public copy Campaign → Classroom Qualifier, `/lp/mncose26`, `/api/cq-lead`, checkout promo codes | #683, #684, #714 | #730 (`e9ac3ffd`), cherry-picked |
| Phases 1–2: hub, `/2026-27`, `/spring-2027`, `/resources` library, teacher stories, `TierTable`, in-app Catalyst prompts, 301s, nav | #752 (`efea764a`) | #758 (`449a6a30`) |
| Next.js 16.4.2 → 16.4.5 for GHSA-mfr8-8qww-v76h (not reachable here) | #762 (`d9ac1cee`) | #771 (`49eb2c9a`) |
| Promotion of everything on dev on 16 Nov (S5 wave 8 slices, event emails, `/events` cards, #762) | — | #771 (`49eb2c9a`), deployment `dpl_7QVreKKG7T11chJVWz529SMafpcX` |

Release records: `.claude/releases/promote-2026-11-16c.md` (#758) and `promote-2026-11-16d.md` (#771). #771 applied two migrations first through the Production migration Action (`email_outbox_tenant`, `tenant_host_map`), each approved by the owner.

Where things live:
- Facts and copy: `content/cq/facts.ts`, `resources.ts`, `faq.ts`.
- Form sources: `content/cq/form-sources.ts`. One HubSpot form for every page, told apart by `lp_source_page` (`cq-hub`, `cq-2026-27`, `cq-spring-2027`, `cq-resources`, `mncose26`) and `cq_window`.
- Pages: `app/(stellr)/(public)/classroom-qualifier/**`, components in `components/cq/`.
- Upgrade prompts: `lib/cq-upgrade-prompt.ts`, shown on the dashboard and the Qualifier workspace to free-tier teachers.
- Follow-up email drafts: `docs/classroom-qualifier/HUBSPOT-SEQUENCES.md`. HubSpot's API cannot create sequences, so none exist in HubSpot.

## Verified

- Production after #758: the four Qualifier pages answer 200 with no "campaign" in rendered text; `/stories` 404 (no story cleared, as designed); the old `/events/*-campaign-fall` URLs 301 with UTMs and anchor; sitemap correct; `bit.ly/27-qualifier` lands on the hub.
- Production after #771: www 200, app 307 to sign-in, cron 401; `/events` shows "Grades 7–12" and "Grades 9–12" pills; an unsigned webhook POST still answers 400.
- #762's tenancy golden change was font file hashes only: 776 routes, no status, length or body change.

## Not verified

- A real HubSpot submission from any Qualifier page (the dev project has no HubSpot variables, on purpose).
- The in-app Catalyst prompt in a signed-in session (unit tests only).
- MNCOSE26 on the live checkout.
- That production serves 16.4.5's font files: the Vercel status ties the deployment to `49eb2c9a`, but the font names were not read from a live page.

## Gaps from this session

- **The Sanity updates the original ask included were not made.** Both Fall Qualifier documents still have deadlines 2026-12-11 and 2026-12-15 (read 17 Nov). The pages say 1/31/27, but registration and proposal upload close on the Sanity date, so after 12/11 a teacher the site invites will be turned away. Grades min/max are unset, and the deliverable text was not set either. Row `classroom-qualifier.1`.
- No Spring 2027 documents exist in Sanity, so the spring page says registration opens 1/1/27 and nothing more.
- #772 (the #771 record) was cut from a stale `main` and missed its merge commit, so #773 had to sync `main` into `dev`. #772 also merged while the non-required `tenant-db` check was still pending. Both are noted in memory for the next promotion.
- Squash merges into `dev` add a `Co-authored-by` trailer with a work address (32 of 40 recent commits). Not rewritten; the fix is GitHub's noreply address on the merging account. Row `classroom-qualifier.9`.

## Open questions for the owner

Rows `classroom-qualifier.5`–`.8`: what is free (whole pack vs abridged for Educator), whether the overview deck and pacing guide exist, Judging Rubric criteria names and the Flyer B image, and PD hours (5–10 vs 10–20). Also from #757 (another session's, promoted here): resend caps, the sweep gate, and the resend button copy.
