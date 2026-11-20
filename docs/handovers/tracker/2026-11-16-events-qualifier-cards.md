# /events Classroom Qualifier cards — 2026-11-16

Slug: `events-qualifier-cards`. Handover: `HANDOVER-events-qualifier-cards-2026-11-16.md`. Doc snapshot: `1FRHP1uZHh7wN5gLhnYfUeLRIuETkiDt1mIl8J8KETYM`.
PR #763 → `dev` as `a21dc9cf`; not promoted (owner promoting in another session). Migration: none.

Qualifier cards on `/events` now match Challenge cards: status pill, gold "Compete Now" left, "Qualifier details →" right, no Async line. Every grade pill reads "Grades x–y" from `gradeBand()`, with grade 7 the floor (Middle School 7–8, Both 7–12).

| # | Item | State | Next | Done |
|---|---|---|---|---|
| events-qualifier-cards.1 | Hosted Studio shows the grade-7 floor | `Rule.min(7)` and new descriptions are in `sanity/schemas/event.ts` on `dev`; hosted Studio not redeployed | Owner: redeploy the hosted Studio after promotion | ☐ |
| events-qualifier-cards.2 | Sanity events with a grade below 7 | Not checked; the site clamps them to 7, so cards are right | Query events with `gradeMin < 7` or `gradeMax < 7`; fix any found before the Studio redeploy | ☐ |
| events-qualifier-cards.3 | "Compete Now" on Challenge cards too? | Session read it as qualifier card + page only; Challenge cards say "Register Now" | Owner: confirm, or ask for Challenges to change | ☐ |
| events-qualifier-cards.4 | Hub CTA wording | Qualifier detail links redirect to the `/classroom-qualifier` hub, whose CTA reads "Get the free curriculum — due 1/31/27" (`components/cq/WindowPage.tsx`) | Owner: keep, or change to "Compete Now" | ☐ |
| events-qualifier-cards.5 | Grade 6 in member forms | Still offered in `SCHOOL_GRADES`, onboarding, admin member forms, `ParticipantForm`, `lib/graduation-year.ts` | Owner: decide whether to remove; if yes, a separate change that handles existing grade-6 members | ☐ |
| events-qualifier-cards.6 | Promote #763 | On `dev` as `a21dc9cf`; CI green except osv-scanner (fixed on `dev` by #762) | Owner's promotion session; then check `/events` on production | ☐ |
