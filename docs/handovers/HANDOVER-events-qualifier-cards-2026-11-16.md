# Handover: /events Classroom Qualifier cards, 2026-11-16

Slug: `events-qualifier-cards`. Tracker: `tracker/2026-11-16-events-qualifier-cards.md`.
PR #763 → `dev` as `a21dc9cf`. **Not promoted.** The owner is promoting it in
another session. Migration: none. Sanity schema: changed (needs a hosted Studio redeploy).

## What was asked

An iteration on the public `/events` board. The owner's corrections during the
session take precedence over the original request.

1. The Challenge/Event card is the standard. Classroom Qualifier cards must match it.
2. Grade pills always read "Grades x–y", never "High School" or "Both".
   - Correction: 7th grade is the youngest grade accepted, so Middle School is 7–8, not 6–8.
   - "This fix to wording must apply everywhere."
3. The qualifier button is the Challenge colour (gold `btn-energy`) and sits on the left.
   - Correction: it reads "Compete Now", not "Participate Now".
4. The details link sits on the right and reads "Qualifier details →".
5. Remove "Async — runs at your school".
6. Added during the clarifying questions: qualifier cards get the registration status pill, and the
   button is hidden when registration isn't open, as on Challenges.

## What changed (#763)

**Grade wording and the 7th-grade floor (`lib/grade-band.ts`)**

- `label` is always `Grades ${min}–${max}`.
- Default bands:
  - High School: 9–12
  - Middle School: 7–8
  - Both: 7–12
- `FLOOR` is 7, so an override below 7 is clamped up to 7.
- Every place that reads `gradeBand()` follows: both card kinds, the event detail heroes, the
  eligibility sentence, the registration grade dropdown and the HubSpot demographic.

**Sanity schema (`sanity/schemas/event.ts`)**

- Field descriptions updated for the new bands.
- `Rule.min(7)` on `gradeMin` and `gradeMax`.

**Status pill (`components/ui/RegistrationStatusPill.tsx`)**

- New shared component.
- `EventCard` and `CampaignCard` both use it.
- `CampaignCardData.status` comes from `campaignStatusKey()`.

**Qualifier card (`components/campaigns/CampaignCard.tsx`)**

- Same footer as `EventCard`: gold "Compete Now" on the left, "Qualifier details →" on the right.
- The Async line is gone.
- The "Proposal due" line is kept.

**Button (`CampaignCardAction` in `CampaignMemberAware.tsx`)**

- A `SiteLink` with `prefetch={false}` and the `btn-energy` class.
- Takes an `isOpen` prop.
- A member who is already registered still sees the green "Registered" pill.

## Verified

- CI on #763:
  - Passed: `verify`, `unit`, `e2e-tests / Run npx playwright test`, `e2e-local / Run npx playwright test` and `storybook`.
  - Failed: `osv-scanner`, on the Next.js 16.4.2 advisory. #762 (next 16.4.5) already fixed this on `dev`; #763 did not touch the lockfile.
- Local preview at `localhost:3010/events` (dev server, dev data):
  - Qualifier cards show "Grades 9–12" and "Grades 7–12", the status pill, gold "Compete Now" on the left, "Qualifier details →" on the right, and no Async line.
  - The Minnesota event hero reads "Grades 7–12".
  - No console errors.
  - No horizontal overflow at 375px.

## Not verified

- **The deployed `dev` alias:** not opened after the merge.
- **The registration grade dropdown:** not checked in a browser. Only the unit tests cover it.
- **Existing Sanity events with `gradeMin`/`gradeMax` below 7:** not checked.
  - The site clamps them to 7, so the cards are correct.
  - Once the Studio is redeployed, those documents will fail the new validation when an editor next opens them.

## Open items

See the tracker for State, Next and Done.

- **`.1` Studio redeploy:** redeploy the hosted Studio (https://stellr.sanity.studio) so editors see the 7th-grade floor.
- **`.2` Sanity data:** look for events with a grade below 7.
- **`.3` "Compete Now" scope:**
  - This session took "make them all Compete Now" to mean the qualifier card and qualifier page only.
  - Challenge cards still say "Register Now".
  - Owner to confirm.
- **`.4` Hub button wording:**
  - Both qualifier detail links redirect (`next.config.mjs`) to the `/classroom-qualifier` hub.
  - The hub's button reads "Get the free curriculum — due 1/31/27", not "Compete Now".
  - Owner to decide.
- **`.5` Grade 6 in member forms:**
  - Member forms still offer grade 6: `lib/registration-constants.ts` `SCHOOL_GRADES`, `OnboardingForm`, `AdminAddMember`, `AdminMemberDetail`, `ParticipantForm` and `lib/graduation-year.ts`.
  - These record a member's own grade, not who an event accepts. Removing grade 6 would affect existing member data, so it was kept out of scope.
- **`.6` Promotion:** in the owner's other session.
