# Handover: teacher name badges, 17 Nov 2026

Slug `teacher-badges`. Tracker: `tracker/2026-11-17-teacher-badges.md`.

## What was asked
An option to print teacher-specific name badges: teacher names merged onto a custom uploaded background, falling back to the "Everyone" default when nothing is uploaded. Build and ship to dev. The session then promoted it as well.

## What changed (live in production)
- **Teachers background** per Avery format, on an event's Settings → Name badges (event only; no theme-level default, by design). Rows go in `event_badge_templates` with `audience = 'teachers'`.
- **Fallback:** without a Teachers background, a teacher's badge uses their company's background, else Everyone's (the event's own, else the theme default), else a plain badge. That comes from `pickTemplate` in `lib/badge-layout.ts`. With one, it beats a company background, as the Mentors background does.
- **"Teachers only"** checkbox: `GET /api/admin/events/[slug]/badges?who=teachers` prints only participants with `event_role = 'teacher'`, followed by blank spares on the same background. The file is `<slug>-teacher-badges-<format>.pdf`.
- **Migration** `20261117213655_event_badge_templates_teachers.sql` widens the `audience` CHECK and only expands it. It was applied to the dev DB through the MCP, with the ledger realigned to the filename. In production it ran through the Production migration Action (run 44186760708, owner-approved) before the code merged.

PRs: #793 to dev (`aa0f31ef`); promotion #796 (`fe7af894`, deployment `dpl_GFMm5HH7FmqcbavBHJTzqmCGbaHA`); record and sync #797 (`4bdfb477`). The rollback target before the promotion was `dpl_HPswTKjoPhN8pTEdUMT1A721UNxs`.

## Verified
- Unit tests: teacher precedence and fallback in `pickTemplate`; `loadBadgeHolders` marks teachers, and `who: 'teachers'` returns only them, with no volunteer mentors.
- CI green on #793 and on #796's merged head. The unit and `npx playwright test` steps ran.
- Dev DB: a teachers-only PDF generated for one event (1 badge and 11 spares, on the theme's Everyone default).
- Production: www 200; app redirects to /sign-in; the cron guard answers 401; the badges route refuses signed-out requests (401).

## Not verified
- Nobody has clicked through the new controls signed in, in dev or in production. That covers the upload, positioning the name, the "Teachers only" download, and the hint text next to it.
- The generated PDF was checked by size only. Nobody has looked at it.

## Decisions taken without asking (worth confirming)
- "Teacher" means `participants.event_role = 'teacher'`. A school student manager (`school_student_manager`) is not included.
- A teacher's badge in the full print also uses the Teachers background, not only in the teachers-only run.
- The theme defaults page (Competitions → Default artwork) has no Teachers slot. Teachers fall back to the Everyone default instead.

## Open items
See the tracker rows `teacher-badges.1` to `.4`.
