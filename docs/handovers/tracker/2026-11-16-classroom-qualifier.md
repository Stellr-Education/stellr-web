# Classroom Qualifier website, Phases 0–2 — 2026-11-16

Slug: `classroom-qualifier`. Handover: `HANDOVER-classroom-qualifier-2026-11-16.md`. Doc snapshot: `1lg10O3XN8rxbLG0l5tHRTDS-wp1hOMhN9MWk-KMMiT8`.
PR #752 → `dev` as `efea764a`; promoted in #758 (`449a6a30`). PR #762 → `dev` as `d9ac1cee`; promoted in #771 (`49eb2c9a`). Migrations: two (S5 M7, from #754) applied to production by the Action before #771.

The Classroom Qualifier hub, both window pages, the curriculum library, teacher stories and in-app Catalyst prompts are live, as is Next.js 16.4.5. What is left is content in Sanity and HubSpot, and owner decisions.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| classroom-qualifier.1 | Fall Qualifier deadlines in Sanity | Both Fall docs read deadline 2026-12-11 and 2026-12-15, grades unset (Sanity read 17 Nov). Site says 1/31/27; registration and upload close on the Sanity date. | Owner sets both deadlines to 2027-01-31 and grades 7–12 in Studio, or says yes to an agent patch. | ☐ |
| classroom-qualifier.2 | Hosted Studio shows Teacher Story | `teacherStory` schema is in the repo and on production; hosted Studio not redeployed since. 0 stories exist. | Owner runs `npx sanity deploy`. | ☐ |
| classroom-qualifier.3 | Spring 2027 documents | None in Sanity; `/classroom-qualifier/spring-2027` shows "opens 1/1/27" only. | Create both spring theme documents (season spring, campaignYear 2027, deadline 2027-05-14). | ☐ |
| classroom-qualifier.4 | HubSpot follow-up sequences | Drafted in `docs/classroom-qualifier/HUBSPOT-SEQUENCES.md`; nothing in HubSpot. | Owner pastes them into HubSpot and leaves them inactive until approved. | ☐ |
| classroom-qualifier.5 | What is free | Handover says the whole pack; the tier waterfall gives Educator an abridged RFP and basic guides. Library and form say free; tier table shows the waterfall. | Owner decides; change whichever side loses. | ☐ |
| classroom-qualifier.6 | Overview deck and pacing guide | Listed in the library per the handover; existence not confirmed. | Owner confirms, or remove them from `content/cq/resources.ts`. | ☐ |
| classroom-qualifier.7 | Judging Rubric criteria and Flyer B image | Still missing (since Phase 0). | Owner supplies both. | ☐ |
| classroom-qualifier.8 | PD hours | Handover 5–10; `lib/grant.ts` 10–20. | Owner picks one; update the other. | ☐ |
| classroom-qualifier.9 | Work address in squash-merge trailers | `Co-authored-by` trailer with a work address on 32 of 40 recent dev commits. | Owner sets the merging account to the GitHub noreply address. | ☐ |
| classroom-qualifier.10 | Live checks not done | No real HubSpot submission, signed-in prompt, or MNCOSE26 live checkout tested. | One test submission from the hub with UTMs; check it lands in HubSpot with `lp_source_page=cq-hub`. | ☐ |
| classroom-qualifier.11 | Next.js 16.4.5 in production | Promoted in #771; Vercel status success on `49eb2c9a`; osv-scanner green on #762. | — | ☑ |
| classroom-qualifier.12 | Phases 1–2 in production | Promoted in #758; pages, 301s and sitemap checked live 16 Nov. | — | ☑ |
