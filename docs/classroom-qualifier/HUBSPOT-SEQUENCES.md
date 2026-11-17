# Classroom Qualifier — HubSpot follow-up emails (DRAFTS)

**Status: drafts only. Do not activate until the owner approves** (V2 handover
§3.5 and Phase 2). HubSpot's API cannot create sequences or workflows, so these
are written here to paste into HubSpot, where they stay inactive until
approved.

The in-app upgrade prompts (`lib/cq-upgrade-prompt.ts`) follow the same
cadence, so the app and the inbox say the same thing in the same week.

## Who gets them

Build each as a **contact-based workflow** (Marketing Hub), not a Sales
sequence, so the emails carry the subscription footer:

| Workflow | Enroll when | Re-enroll |
|---|---|---|
| CQ fall follow-up | `lp_program_interest` = `classroom-qualifier` **and** `cq_window` = `2026-27` **and** `lp_source_page` is not `mncose26` | No |
| CQ fall follow-up (MnCOSE) | as above, but `lp_source_page` = `mncose26` | No |
| CQ spring follow-up | `lp_program_interest` = `classroom-qualifier` **and** `cq_window` = `spring-2027` | No |

The form that sets these is "Website — Classroom Qualifier Curriculum Request"
(`/api/cq-lead`, every Qualifier page and `/lp/mncose26`).

**Unenroll** when the contact's proposal is in (if a property is added for it)
or the contact unsubscribes.

## Rules for every email (CAN-SPAM and the handover)

- From the Stellr Education team address; a real reply-to.
- The footer carries the physical mailing address (HubSpot's office-location
  token, `{{ site_settings.company_address }}`) and the unsubscribe link
  (`{{ unsubscribe_link }}`). HubSpot's default marketing-email footer does both;
  do not remove it.
- Teacher data only. Never ask for student names or details.
- American English, US dates (1/31/27). Never the word "campaign".
- One call to action per email.
- Every link carries `utm_source=hubspot&utm_medium=email&utm_campaign=classroom-qualifier&utm_content=<step>`.

## Fall window (2026–27): submit by 1/31/27

### 1. Day 0 — downloads and how to start
- **Delay:** immediately on enrollment.
- **Subject:** Your Classroom Qualifier curriculum
- **Preview:** The RFP, Mission Handbook, schedules and Judging Rubric.
- **Body:**
  > Hi {{ contact.firstname }},
  >
  > Thanks for asking for the Classroom Qualifier curriculum. It’s free, and it’s yours to use however suits your class.
  >
  > **Start here:** create your free Educator account to download the full pack: the Request for Proposal (RFP), the Mission Handbook, the 4- and 10-week schedules, the Teacher and Student Guides and the Judging Rubric.
  >
  > **How to start:** share the RFP and the Judging Rubric with your students on day one, pick the 4- or 10-week schedule, and split the class into teams of 2–12.
  >
  > Your team’s 10–20 page proposal is due **1/31/27**. Industry professionals judge every proposal, and every team gets written feedback.
  >
  > You bring the passion — we provide the scientists.
- **CTA:** Create my free Educator account → `https://app.stellreducation.org/sign-up?utm_…&utm_content=day0`

**MnCOSE variant (step 1 only):** add this block above the sign-off:
  > **Met us at MnCOSE?** Your free Catalyst membership is waiting. Create your free Educator account, choose Catalyst under Membership, and enter **MNCOSE26** at checkout. The code expires 1/31/27.

### 2. Day 7 — week 2 check-in + Catalyst
- **Delay:** 7 days after step 1.
- **Subject:** Week 2: how is your team getting on?
- **Body:**
  > Hi {{ contact.firstname }},
  >
  > By now most teams have read the RFP and started on their mission. If yours hasn’t, the 4-week schedule still gets you to 1/31/27 with time to spare.
  >
  > Want less prep? **Catalyst** adds the full material and PD hours. Every paid tier carries our 100% money-back guarantee within 45 days.
- **CTA:** Compare Catalyst → `https://www.stellreducation.org/membership?utm_…&utm_content=week2#catalyst`

### 3. Sunday 1/17/27 — two weeks to go + upgrade
- **Delay:** until 1/17/27 (fixed date).
- **Subject:** Two weeks to go: proposals due 1/31/27
- **Body:**
  > Hi {{ contact.firstname }},
  >
  > Two weeks until proposals are due on **1/31/27**. Use the Judging Rubric as a checklist: industry judges score three equally weighted criteria.
  >
  > Need a hand finishing? Catalyst adds the full material and PD hours.
- **CTA:** Open my curriculum → `https://app.stellreducation.org/campaigns?utm_…&utm_content=2wk`
  *(App route name; the link text never says it.)*

### 4. Sunday 1/31/27 — deadline day
- **Delay:** until 1/31/27, 8:00 AM recipient time.
- **Subject:** Proposals are due today
- **Body:**
  > Hi {{ contact.firstname }},
  >
  > Today’s the day: upload your team’s 10–20 page proposal before midnight.
  >
  > Missed it? The Spring 2027 window is open now: submit by 5/14/27.
- **CTA:** Submit our proposal → `https://app.stellreducation.org/campaigns?utm_…&utm_content=deadline`

### 5. After submission — thanks + feedback date
- **Trigger:** proposal submitted (needs a submitted flag synced to HubSpot; until then send on 2/1/27 to everyone still enrolled).
- **Subject:** Thank you: your proposal is in
- **Body:**
  > Hi {{ contact.firstname }},
  >
  > Thank you, and well done to your team. Our industry judges are reading every proposal now. You’ll have written feedback and the awards by **1/31/27**.
  >
  > Winning teams are invited to the 2027 International Summer Camp at NASA Johnson Space Center, Houston. A camp fee applies.
- **CTA:** See the Classroom Qualifier → `https://www.stellreducation.org/classroom-qualifier?utm_…&utm_content=thanks`

> **Open with the owner:** the fall deadline and the feedback + awards date are
> both 1/31/27 as supplied, so step 5's "feedback by 1/31/27" lands on or
> before the day it is sent. Confirm the feedback date before activating.

## Spring window (Spring 2027): opens 1/1/27, submit by 5/14/27

Same five emails, with these changes:

| Step | Timing | Date-specific copy |
|---|---|---|
| 1 Day 0 | on enrollment | "Your team’s 10–20 page proposal is due **5/14/27**." No MnCOSE variant. |
| 2 Day 7 | 7 days after step 1 | "the 4-week schedule still gets you to 5/14/27" |
| 3 Two weeks to go | **Friday 4/30/27** | Subject: "Two weeks to go: proposals due 5/14/27" |
| 4 Deadline day | **Friday 5/14/27**, 8:00 AM | "Missed it?" line removed |
| 5 Thanks | on submission (or 5/15/27) | "written feedback and the awards by **5/31/27**" |

## Targets to report against (handover §3.5)

40 booth conversations → 20 sign-ups → 6 registered teams → 3 Teacher Grant applications.

- Sign-ups: contacts with `lp_source_page` = `mncose26`.
- Registered teams: Classroom Qualifier registrations in the admin console.
- Grant interest: `cq_teacher_grant_interest` = true (applications are counted in the grant admin).
