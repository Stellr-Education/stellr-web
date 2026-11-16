# Email Engagement tab and Outstanding payments recipients — 2026-11-16

Slug: `email-engagement`. Handover: `HANDOVER-email-engagement-2026-11-16.md`. Doc snapshot: `1YJRBkd5mka5U4VGzzR6DiFGyqeYTa1V_IcGe-vQMbC4`.
PR #765 → `dev` as `fda52b70`; not promoted (owner promoting in another session). Migration: none.

The event's "Email Reminders" tab is now "Email Engagement". In "Outstanding payments", an invoiced or group-paid place emails only the group's organiser (teacher or student manager) and teacher contact. A place paid by its own link emails the person, their parent and the organiser.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| email-engagement.1 | Promote #765 to production | On `dev` as `fda52b70`, with CI green on #765. Not in production. | Owner promotes, in another session. No migration needed. | ☐ |
| email-engagement.2 | See the new recipients on a real roster | Unit-tested only. No browser or dev-database preview has been done. | On a dev event with an invoiced group, open Email Engagement, preview an "Outstanding payment" email, and check that only the organiser and teacher contact are listed for that group. | ☐ |
| email-engagement.3 | Legacy `/api/admin/events/[slug]/remind` still CCs parents of invoiced groups | No UI calls it (checked by `git grep` on 16 Nov), but the route is live and keeps the old rule. | Delete the route, or route it through `buildRecipients`. | ☐ |
| email-engagement.4 | Starter "Outstanding payment" copy for organisers | An organiser who gets only the "still to pay" list still reads "We haven't received payment for this registration yet". | Decide whether the default template needs an organiser variant. This affects new events only. | ☐ |
