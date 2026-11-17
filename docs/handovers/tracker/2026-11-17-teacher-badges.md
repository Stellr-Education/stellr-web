# Teacher name badges — 2026-11-17

Slug: `teacher-badges`. Handover: `HANDOVER-teacher-badges-2026-11-17.md`. Doc snapshot: `1MgIlh1Ibf07PYzjuNuaiKmRE5FPaYyqGgL5_5dGrwqQ`.
PR #793 → `dev` as `aa0f31ef`; promoted in #796 (`fe7af894`). Migration: `20261117213655_event_badge_templates_teachers` (dev and production).

Name badges have an optional Teachers background and a "Teachers only" print. Teachers fall back to the Everyone background (the event's own, else the theme default). It is live in production.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| teacher-badges.1 | Signed-in click-through of the Teachers upload and the "Teachers only" download | Not done anywhere. Covered only by unit tests, a dev-DB PDF run and the signed-out 401 check in production | Owner: on a real event's Settings → Name badges, upload a Teachers background, position the name, then download with "Teachers only" ticked | ☐ |
| teacher-badges.2 | Confirm who counts as a teacher | Only `event_role = 'teacher'`. Student managers are excluded, and so are adult chaperones registered with another role | Owner: say whether `school_student_manager` (or others) should print as teachers. If so, it is a one-line change in `loadBadgeHolders` | ☐ |
| teacher-badges.3 | Theme-level Teachers default | Not built, by design. Teachers fall back to the Everyone default | Owner: decide if every event should share a Teachers default. If so, add `'teachers'` to `default_badge_templates` and the defaults route | ☐ |
| teacher-badges.4 | `loadBadgeHolders` treats a failed query as an empty list | Seen once on 17 Nov: a dev-DB run returned 0 holders, and a re-run returned the correct 4. Predates this session | Check `error` on the registrations query and throw, so the route returns 500, not "No participants" | ☐ |
