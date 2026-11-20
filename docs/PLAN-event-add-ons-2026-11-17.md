<!-- Scope, requirements, risks and implementation plan for event add-ons. -->

# Event add-ons: accommodation, experiences and merch

**Status:** every owner question was answered on 17 Nov 2026. The plan awaits the owner's go-ahead to build. No code has been written.
- Written 17 Nov 2026 against `dev` at `6990b9de`.
- Revision 2, same day: merch joins the plan; room and hotel management are out of scope; US-14 and US-15 are removed; US-20 is rewritten; nothing is built for other tenants.
- Revision 3, same day: Q1 to Q10 answered; the minor-accommodation message and the overnight addendum hook added; account credits are removed (Phase R).
- Revision 6, same day: Q13c, Q17b and Q21 to Q23 answered; all questions are closed.
- Revision 5, same day: Q13b and Q16 to Q20 answered; Q13c and Q17b added.
- Revision 4, same day: Q11 to Q15 answered; organisers choose add-ons (no "offer" step); members buy only their own merch; the merch upsell is on by default; Q13 reworded as Q13b; Q19 reworded.

People are named by role only. The owner questions are in §4, numbered in the order they will be asked (five at a time). Each has a proposed default, which is built unless the owner says otherwise.

---

## 1. What we are building

An **add-on** is an optional extra that a Stellr event offers on top of a place, either priced or free. There are three kinds:

| Kind | Examples | Where it shows |
|---|---|---|
| **accommodation** | a night's stay with its meals | event card pill, event page, registration, member pages |
| **experience** | SpaceX half-day tour | event card pill, event page, registration, member pages |
| **merch** | event shirt, hoodie (the existing Printful-batched event merch) | registration and member pages, beside the other add-ons. **Never on event cards.** Shown as an upsell (event page and registration) only when the event's **merch upsell** setting is on |

Staff set add-ons up per event. Registrants can book them **at registration or afterwards**, up to each add-on's cut-off. They can be booked **for one person, a whole group, or part of a group**, and the payer can differ from whoever pays for the place.

### Launch case: Texas Space Design Competition (Baylor University, Waco)

- **The event:** Sat 6 Mar 2027, one day. Capacity 50. The fee is a USD Stripe Price.
- **Registration:** open, closes 18 Dec 2026. Nobody has registered yet (owner, 17 Nov).
- **Accommodation add-ons:** Fri 5 Mar night and/or Sat 6 Mar night, each with meals.
- **Experience add-on:** SpaceX tour, likely Sun 7 Mar morning, small fee.
- **Merch:** optional, set per event.

### Out of scope

| Out | Where it goes |
|---|---|
| **Room and hotel management**: room assignment, rooming lists, hotel blocks and release or attrition dates, supervision ratios per room | A separate future body of work. Here, accommodation is only a dated, priced add-on with a capacity in people |
| **Other tenants (ASDC and later)**: no tenant UI, flags, AUD charging or booking-only mode in this work | Future work after S8/S9. Recorded in memory. The tables still carry `tenant_id` (a repo rule), and tenant hosts refuse add-ons |
| **Waitlists** | Later |

---

## 2. What the code review found

### 2.1 What exists and is reused

- **Merch add-ons work for individual registrations only:**
  - `event_store_offerings` (`variant_id`, `treatment = included | addon`).
  - Prices come from `store_variants`.
  - Bookings are `store_order_items` (`line_source = event_addon`) on one `store_orders` row per registration (`channel = event_registration`).
  - Charging: `prepareRegistrationAddons` → `pendingAddonLines` adds `price_data` lines to the registration Checkout.
  - Completion: `finalizeRegistrationMerch` runs on confirmation, then the event's single Printful batch is committed from `admin/events/[slug]/merch/commit`.
  - The free "included" shirt is allocated per participant from their t-shirt size.
  - Code: `lib/store/event-merch.ts`, `lib/registration-checkout.ts:284-302`.
- **One payer per person for places:** `participants.payer` (`group | self | shared`) plus `late_joiner_payer`, in `lib/group-payer.ts` and `lib/payment-status.ts`.
- **Pay links someone else can open:** `/register/[slug]/pay/[token]` and `/register/[slug]/pay-seat/[token]`.
- **Group invoice machinery** (`lib/group-billing.ts`):
  - An unpaid invoice is **revised** in a batch after the roster has been quiet for a couple of minutes (`reviseGroupInvoice`). After 4 revisions it is replaced.
  - Once the invoice is paid, a change produces an **"additional" invoice** (`planSeatChange`, l.162-181).
  - These are the behaviours US-20 needs.
- **Charging outside registration:** the store checkout (`{type:'store_order', orderId}` metadata, settled by `handleStoreOrderPaid`).
- **Check-in** already shows merch per person, with a `merch_collected` tick.
- **Tenancy groundwork:**
  - the tenant-derive trigger on `event_slug`;
  - the via-parent trigger;
  - `tenant_app` RLS;
  - the S0 grant rules;
  - `platform_audit_events` and `record_access_log`.

### 2.2 What must change for US-20 (the biggest piece of risk)

Group invoices assume **one line: seats × one price**:
- `draftWithLine` creates a single invoice item;
- `ledgerRowFromInvoice` records `seats` and `per_seat_cents`;
- `perSeatPaidCents` = total ÷ seats;
- the refund basis (`lib/refunds/payment-basis.ts`) uses total ÷ seats for invoiced groups.

Putting add-on lines on the same invoice breaks every one of those. The plan:
- **Add `group_invoice_lines`**: one row per Stripe invoice item, with `kind` (`seat | addon`), the add-on booking it covers, `unit_cents`, `quantity` and `stripe_invoice_item_id`.
- **Move per-seat paid and the refund basis to read seat lines only**, and add-on refunds to read their own line.
- **Extend revision and "additional" to cover add-on lines.** The rule becomes: changes go onto the group's open (unpaid) invoice. If every invoice is paid, the add-on change gets a new **add-ons-only** invoice (`kind = 'addons'`), and later changes revise that one while it is unpaid.
- **Make discounts line-level**, so that a group's invoice coupon keeps applying to places only (§4 Q6). A Stripe coupon on the invoice itself would discount every line.

### 2.3 Defects in today's merch add-ons (fixed by this work)

| # | Defect | Where | Fixed in |
|---|---|---|---|
| D1 | A scholarship coupon discounts the whole Checkout, merch included. The recorded amount adjusts the fee only | `lib/registration-checkout.ts:191-210` | Phase 3 |
| D2 | Refunds ignore add-on lines. Withdrawal never cancels `store_order_items` | `lib/refunds/payment-basis.ts`, `lib/deletion/execute.ts` | Phase 4 |
| D3 | `amount_due_cents` leaves add-ons out | `lib/registration/individual/gate.ts:327-362` | Phase 3 |
| D4 | Stripe metadata carries `participantName` / `participantEmail` (a minor's data at a third party) | seat and registration Checkouts | New code uses ids only; the old keys are removed in Phase 3 |
| D5 | Two duplicate Checkout builders sit outside the helpers | `members/teams/[id]/payment-link:100`, `members/billing/payment-link:134` | Phase 3 routes them through the helper |
| D6 | Currency is hard-coded to `'usd'` on add-on lines | `registration-checkout.ts:149` | Phase 1 (currency from the add-on) |
| D7 | The group form has no merch at all | `GroupRegistrationForm.tsx` | Phase 3 |

### 2.4 Constraints

- **Decision 17** in `docs/PLAN-multi-tenant.md` lists accommodation as a "future module". The room and hotel module stays future. A plain accommodation add-on on Stellr events needs that distinction recorded in the decision register (§4 Q1).
- **Lane ownership:**
  - Lane A owns `app/api/register/**`, `lib/registration/**`, the flow pages, and the Stripe and webhook routes.
  - Lane C owns admin routes, `lib/events/**` and the generated baselines.
  - S5 wave 8 is paused, with PRs open.
  - New code goes in `lib/addons/**`, `app/api/addons/**` and `app/api/admin/events/[slug]/addons/**`, with small named hooks in shared files.
- **Events stay in Sanity until S8.** New tables key on `event_slug text`, which `rename_event_slug()` rewrites.
- **Paid events on other tenants are refused until S9.** Add-ons follow the same refusal, and the add-on UI is not mounted on tenant hosts.

---

## 3. Requirements

### 3.1 Actors

| Actor | Today |
|---|---|
| Stellr staff / admin | `requireEventCrew` |
| Assigned event manager | `requireEventAccess` |
| Teacher (group organiser) and Teacher POC | `ownsTeam` |
| Student manager | `teamViewerRole = student_manager`; read-only on payment today |
| Group member (student or adult) | participant in a group registration |
| Individual registrant | individual registration |
| Third-party payer (district, parent or guardian) | invoice recipient, or whoever opens a pay link |
| Public visitor | event list and detail pages |

### 3.2 User stories

US-14 and US-15 are withdrawn. Their numbers are kept so references stay stable.

**Staff**
- **US-1** As staff, I can add, edit, reorder, hide and archive add-ons for an event. For each I set:
  - the kind and title;
  - a description, and what's included (for example "dinner Fri, breakfast Sat");
  - the service date(s);
  - the price and the capacity in people;
  - the sales window and cut-off;
  - who may take it (students, adults, or both);
  - the refund rule.

  For merch, I pick store products and variants instead of typing a price. The store price is used.
- **US-2** As staff, I can record what the event fee already includes, including the free event shirt (today's `included` treatment). It shows as "What's included", not as an add-on.
- **US-3** As staff, I can turn an event's **merch upsell** on or off. It is **on by default for every event** (owner, 17 Nov). When it's on, the event's merch is promoted on the event page, in registration and on the confirmation page. When it's off, merch is still offered in registration and member pages if any is set up, but it isn't promoted.
- **US-4** As staff, for each add-on I can see what has been booked, paid and left unpaid, the capacity left, and the money by payment method.
- **US-5** As staff, I can close sales early, extend a cut-off, or raise capacity without changing existing bookings.
- **US-6** As staff, I can book or cancel an add-on for anyone, waive a line, mark it paid offline, and refund one line. Each action is audited.
- **US-7** As staff, I can export the list of who booked each add-on. The list holds only the fields that add-on's provider needs. Merch keeps its existing batch export.

**Public visitor**
- **US-8** As a visitor, the event page shows the optional accommodation and experiences with prices, dates and what's included, and says when one is nearly full or sold out. The event card shows a pill such as "Accommodation available" or "Optional tour", and never one for merch. When the merch upsell is on, the event page also shows the event merch.

**Individual registrant**
- **US-9** As an individual registrant, I can choose add-ons during registration (merch beside the rest) and pay for my place and add-ons in one Checkout.
- **US-10** As a registrant, I can add extras later from my event page or Account, up to each cut-off.
- **US-11** As a registrant, I can cancel an extra before its refund cut-off and get the refund its rule allows.

**Teacher / Teacher POC**
- **US-12** As a group organiser (teacher, Teacher POC or student manager), I **choose** the add-ons for my group: the whole group or ticked members, at registration or afterwards. Members don't choose accommodation or experiences themselves (Q15). For merch, I choose a size for each person, pre-filled from their profile.
- **US-13** As a teacher, I choose who pays for each booking:
  - **the group**: on the group's invoice, or by card;
  - **each person**: by their own link.

  This choice doesn't depend on how the places are paid.
- **US-14** *(withdrawn: incorrect, see §4 Q3)*
- **US-15** *(withdrawn: incorrect, see §4 Q4)*
- **US-16** As a group organiser, when I choose an add-on with "each person pays" (for example the SpaceX tour), each chosen member gets their own pay link. I see who has paid and who hasn't, and I can remove an unpaid booking.

**Student manager**
- **US-17** As a student manager, I choose add-ons for my group just as the teacher does (US-12). Whether I can also choose who pays is asked in Q19.
- **US-17a** As a group member, I can buy **merch for myself** (Q14). I can't book accommodation or experiences; my organiser chooses those.

**Group member / payer**
- **US-18** As a group member, I get an email with a pay link when my organiser books an add-on for me as "each person pays". The link shows only my own lines.
- **US-19** As a parent or guardian paying for a minor, I can pay from the link the student forwards, without an account.
- **US-20** As a group whose add-ons are paid by **the group on invoice**:
  - if the group's invoice is **unpaid**, the add-ons are added to it and it is revised;
  - if it has been **paid**, a new invoice for the add-ons only is issued.

  Later changes follow the same rule: revise an unpaid invoice, issue a new one only when everything is paid.

**Everyone**
- **US-21** As anyone who booked, my confirmation email and my member pages (Account, event page, Teams tab) list each add-on, merch included, with dates or size, status and receipt.
- **US-22** As anyone, if a person is withdrawn or removed, or asks for their data to be deleted, their add-ons are cancelled. Each line is refunded **to whoever paid for it**, by that add-on's rule (§4 Q4, Q8).

**Operations**
- **US-23** As a check-in volunteer, I can see and tick a person's add-ons from the check-in desk (on the tour bus, accommodation collected, merch collected).

**Other tenants**
- **US-24** *(moved to future work: tenants. Nothing is built for other tenants in this work. See the memory note "Event add-ons for tenants (future)".)*

### 3.3 Functional requirements

**Catalog**
- **FR-1** An add-on belongs to one Stellr event (`event_slug`). Its currency equals the event's currency (a database trigger). Add-ons are refused on any event whose tenant is not the platform owner.
- **FR-2** Accommodation and experience prices are integer cents in Postgres. Merch prices come from `store_variants` through `computeUnitPrice` (including `store_event_discounts`). The price is snapshotted onto each booking line, so a later change affects later sales only.
- **FR-3** Accommodation is **one add-on per night** (Friday night and Saturday night are separate add-ons), each with its own date and capacity. An optional `display_group` groups them on screen. Rooms aren't modelled.
- **FR-4** Capacity is counted in people. A null capacity means unlimited. Unpaid holds count against capacity until they are released (§4 Q17b). Merch has no capacity.
- **FR-5** Eligibility:
  - **Only people attending the event** (Q3): a participant on a registration for this event, and that registration isn't withdrawn. The person must be on the roster before anything is booked for them.
  - The add-on's audience: students, adults, or both.
- **FR-5a** A minor on an **individual** registration can't book accommodation (Q9). Staff can override this for one booking, and the override is audited. The refusal is shown **before** payment, wherever the option appears: the Extras step, the "Add extras" page, a pay link, and the API. It is a complete message, not an error code:
  - **what:** overnight accommodation is only available to students under 18 travelling with a school or group;
  - **why:** an overnight stay needs a responsible adult from their group;
  - **what they can do:** join or register with a group, or contact Stellr (a contact link) to arrange it.

  The accommodation option stays visible with the message beside it, rather than being hidden. The API returns the same message with a stable refusal code (`addon_minor_individual_accommodation`), and a test covers each surface. Copy per `VOICE.md`.
- **FR-5b** Accommodation add-ons for minors require the **overnight addendum** to the participant and parent agreement (Q10), which is written in December 2026, outside this work.
  - This work adds the hook: `event_addons.requires_addendum`. It is set on accommodation and on the tour, which the addendum also covers (Q11).
  - A minor's line stays `pending_consent` until the addendum is signed for that participant. It holds capacity like an unpaid line, may be paid, and only becomes `confirmed` once signed.
  - Organisers and staff see "Awaiting overnight consent".
  - Until the addendum exists, the hook reads as "not signed". Accommodation for minors can therefore be booked and paid, but not confirmed. **Sales to minors may not open until the addendum is live.**
  - Phase 2 wires the check to the agreement status once the addendum's template id is known.

**Bookings**
- **FR-6** One booking line = one participant × one add-on (× one variant, for merch).
  - For accommodation and experiences there is one active line per participant per add-on (a partial unique index).
  - For merch, a person may buy more than one of the same item (Q13b). There's no per-person limit beyond a sanity cap on one order (Q13c).
  - Lines are only ever for named participants (§4 Q3).
- **FR-7** Each line has a **payer** and a **status**.
  - Payer: `group`, `self`, `included` (waived or covered by staff) or `offline` (marked paid by staff).
  - Status: `held → pending_payment → confirmed`, or `cancelled` / `refunded` / `expired`.
- **FR-8** How a line is paid:

  | Who pays, and how | What happens |
  |---|---|
  | **Group, by invoice** (US-20) | The group's open invoice gains `group_invoice_lines` of kind `addon` and is revised by the existing batched sync. With no open invoice, a new `addons` invoice is created |
  | **Group, by card** | The organiser pays a Checkout for the add-on lines only |
  | **Each person** | Lines are grouped into a per-payer add-on order, paid through a pay link (Checkout) |
  | **At individual registration** | The add-on lines join the registration Checkout as separate lines |

  A group whose places aren't invoiced (paid by card or individually) chooses, when it books, between card now and an add-ons-only invoice to the organiser (Q5).
- **FR-9** The teacher-share pool, place discount codes and scholarships never discount add-ons (Q6 and Q7). Account credits no longer exist after Phase R. Coupons are restricted to the event's product (`applies_to.products`) on Checkout, and applied per line on invoices.
- **FR-10** The cut-off is enforced on the server for booking, cancelling and payment.
- **FR-11** A withdrawal, a roster removal, a deletion or an event cancellation cascades to add-on lines through one function, `cancelParticipantAddons`. Each line is refunded to its own payment:
  - by Checkout: a refund on its payment intent;
  - on an unpaid invoice: the invoice is revised;
  - on a paid invoice: a credit note and a refund.
- **FR-12** Refund rule per add-on: "full until a date, then none", or "follows the event's policy". Merch is refundable until the event's merch batch is committed, then not (`docs/WEB-STORE-PLAN.md:258`). An organiser cancelling the event refunds everything.

**Merch specifics**
- **FR-13** Merch add-ons reference store variants. The person's size is chosen at booking, pre-filled from their t-shirt size. Merch lines still create `store_order_items` (`line_source = event_addon`) once paid, so the Printful batch, the check-in tick and `OrdersList` keep working. The add-on line links to its order item.
- **FR-14** The event's **merch upsell** setting (**default on for every event**, including existing events through the backfill) controls promotion only:
  - **On:** an "Event merch" block on the event page, merch shown first in registration's Extras step, and merch on the confirmation page (Q12).
  - **Off:** merch is listed in Extras and member pages without promotion, and not on the event page.
  - **Always:** merch never appears on event cards.
- **FR-15** Merch sales close when the batch is committed (or at its own cut-off, if earlier).

**Display and outputs**
- **FR-16** Public pages read published add-ons through a cached reader tagged per event. No personal data, and no database call in `proxy.ts`.
- **FR-17** The roster, the CSV export, the check-in desk, Account / Billing, the Teams tab, the member event page and the emails all show add-ons beside one another, merch included. Exports go through the `export` capability and the minor-aware roster rules, and they write `record_access_log`.
- **FR-18** Every mutation is audited (`withAudit`, `platform_audit_append`, ids only) and calls `assertNotImpersonating`.

### 3.4 Non-functional requirements

- **NFR-1 Database rules:** each new table has RLS on, the `tenant_isolation` + guard policies, explicit grants and pgTAP tests. `tenant_id` is derived by trigger. This is a repo rule, even with no tenant features.
- **NFR-2 Webhook:** idempotent, and the amount and currency are verified against the database before anything is confirmed.
- **NFR-3 UI and copy:** `@stellr/web-ui` and tokens only; copy per `VOICE.md`; a Storybook story for any new component.
- **NFR-4 Delivery:** slices of about 30 files or fewer. Migrations reach production through the `Production migration` Action before the code merges.

---

## 4. Questions for the owner (asked five at a time)

| # | Question | Proposed default |
|---|---|---|
| **Batch 1: these block Phase 1** | | |
| Q1 | Record in the decision register that a plain accommodation add-on (a dated, priced night) is in scope now for Stellr events, while room and hotel management stays a future module? | **ANSWERED 17 Nov: yes** |
| Q2 | Where are add-ons set up: the app's database with an admin editor, or Sanity? | **ANSWERED 17 Nov: the database.** An "Add-ons" panel in the event's admin page replaces today's merch editor. Sanity keeps only marketing copy |
| Q3 | (Replaces US-14.) Can a teacher book add-ons for people who aren't on the roster yet? | **ANSWERED 17 Nov: no. An add-on is only for someone attending the event**: a participant on the event's registration whose registration isn't withdrawn. A teacher adds the person to the roster first, then books |
| Q4 | (Replaces US-15.) When someone is swapped out of a group or removed, what happens to their add-ons? | **ANSWERED 17 Nov: as proposed.** They're cancelled and refunded by each add-on's rule. The replacement books their own. Nothing moves across automatically |
| Q5 | A teacher chooses "the group pays" for an add-on, but the group's places are paid by card or individually, so no group invoice exists. Card now, or an add-ons-only invoice? | **ANSWERED 17 Nov: as proposed.** Offer both: card now, or an add-ons-only invoice to the organiser |
| **Batch 2: payments and refunds** | | |
| Q6 | Does the group's invoice discount code also apply to add-on lines? | **ANSWERED 17 Nov: no.** The coupon applies per line to places only |
| Q7 | Do scholarships, account credits or the teacher share apply to add-ons? | **ANSWERED 17 Nov: no.** Staff can waive a line by hand. Account credits are being removed altogether (§6, Phase R) |
| Q8 | Default refund rules | **ANSWERED 17 Nov: yes.** Accommodation and tour: full refund until each one's cut-off, none after. Merch: until the batch is committed. Event cancelled by Stellr: full refund |
| Q9 | Can a minor book accommodation as an individual registrant (not in a group)? | **ANSWERED 17 Nov: as proposed, with a clear error message** (FR-5a). For minors, accommodation is group-only unless staff override. Individuals 18+ may book |
| Q10 | Is a guardian consent or waiver needed for the overnight stay and the tour? | **ANSWERED 17 Nov: yes.** For the overnight stay, the consent is an **addendum to the existing participant and parent agreement**, written in December 2026 outside this work (FR-5b). How the tour is consented is asked in Q11 |
| **Batch 3: merch and choosing** | | |
| Q11 | What does SpaceX require of tour guests (citizenship, photo ID, age, waiver, name deadline)? Is the tour's guardian consent also covered by the December addendum, or by a separate waiver from SpaceX? | **ANSWERED 17 Nov: as proposed.** Collect nothing extra in the app. The export holds names, ages and the group's adult lead. The tour's consent goes into the same December addendum, so the tour add-on also sets `requires_overnight_addendum` (renamed `requires_addendum` at build) |
| Q12 | Where does the merch upsell appear when it's on? | **ANSWERED 17 Nov: as proposed.** An "Event merch" block on the event page, plus merch shown first in registration's Extras step and on the confirmation page. **Addendum:** the upsell is on by default for every event |
| Q13 | Merch quantity: one per person, or several? | **Not clear. Re-asked as Q13b in batch 4** |
| Q14 | Can a teacher buy merch for group members (choosing sizes), or only members for themselves? | **ANSWERED 17 Nov: both.** The organiser's size choice is pre-filled from each member's profile, and members can buy their own (US-17a) |
| Q15 | Can group members opt in and pay for an add-on the teacher hasn't offered? | **ANSWERED 17 Nov: no, and there is no "offer" step.** Teachers and student managers **choose** add-ons for their group. Members don't book accommodation or experiences themselves; they only pay their own link when the organiser picks "each person pays". The `self_serve_allowed` field and the opt-in flow are dropped. Merch is the one thing a member may buy for themselves (Q14) |
| **Batch 4: details** | | |
| Q16 | Texas hotel occupancy tax when Stellr resells nights | **ANSWERED 17 Nov: not applicable.** Stellr isn't reselling rooms; it books accommodation for the event. Prices are entered as the amount charged, with no tax lines |
| Q17 | How long does an unpaid "each person pays" booking hold a place? | **Not clear. Re-asked as Q17b** |
| Q18 | Should the Texas event page say "optional accommodation and tour available" now, before add-ons are live? | **ANSWERED 17 Nov: no.** Add-ons appear on the page only once they're live |
| Q13b | (Q13 reworded.) Can one person buy more than one of the same merch item, for example two shirts? If so, what is the most per person? | **ANSWERED 17 Nov: yes, more than one.** The maximum is asked in Q13c |
| Q19 | (Changed by Q15.) Student managers choose add-ons for the group like teachers. Can they also choose **who pays** for an add-on (the group's invoice, card, or each person)? Today only the teacher can change how the **places** are paid (#573) | **ANSWERED 17 Nov: as proposed.** Yes for add-ons. A student manager picks the payer when booking, but an add-on can only go onto the group's invoice with the teacher's or Teacher POC's agreement, because the invoice goes to the school. Changing how places are paid stays teacher-only |
| Q20 | What do Stripe invoice lines show: per-person lines with first name and last initial, or counts only? | **ANSWERED 17 Nov: counts only.** Counts per add-on ("Friday night × 8"), with names in the app only. Less personal data at Stripe |
| **Batch 5: last details and account-credit removal** | | |
| Q13c | Is there a maximum number of one merch item a person can buy at once? | **ANSWERED 17 Nov: as proposed.** 10 per item in one order, only to catch typing mistakes. Staff can lift it for a booking |
| Q17b | (Q17 reworded.) An organiser books the tour for 12 students with "each person pays". Each student's tour place is reserved at once, before they pay. If a student never pays, when is their place released so someone else can have it? | **ANSWERED 17 Nov: as proposed.** Kept until the add-on's sales cut-off. The organiser and the student get a reminder 7 days before, and the place is released at the cut-off if still unpaid. The organiser can release it earlier. This is only an issue when the add-on has a capacity |
| Q21 | Are mentoring **session credits** (a membership entitlement, not money) also retired? | **ANSWERED 17 Nov: as proposed.** No. They are a separate concept and stay |
| Q22 | Any live credit balance found in production: refund it in cash, or write it off? Keep historical `refund_type = 'credit'` refund rows? | **ANSWERED 17 Nov: not applicable.** The owner confirms there are no live credit balances |
| Q23 | Who runs the production balance count (agents can't read production)? | **ANSWERED 17 Nov: not applicable.** No balances exist (owner) |

---

## 5. Security and privacy

### 5.1 New assets

| New asset | Notes |
|---|---|
| Money | Add-on orders and lines, add-on invoice lines, and a new invoice kind |
| Minors' data | Which nights a minor stays and where they go off-site |
| Recipients | The hotel and SpaceX receive booking lists |

All three need the threat model (`docs/THREAT-MODEL.md`, line 13 rule), the minors DPIA and the sub-processor and data map updated **in the same PR as the first migration**.

### 5.2 Controls

| Threat | Control |
|---|---|
| Client tampers with the price or quantity | The server prices every line from the database or the store. The client sends ids and the merch quantity only, within limits |
| An add-on from another event is booked against this registration | `assertAddonBookable` checks the same `event_slug` and the platform-owner tenant. The RLS guard needs the parent registration. The IDOR generator covers the new routes |
| Booking for someone you don't manage | Organiser routes use `ownsTeam` + `teamViewerRole`. Teachers, Teacher POCs and student managers can book for their own group only. A member can book only their own merch, and acts only on their own lines. A pay link is scoped to one payer's lines |
| Pay-link guessing | HMAC tokens that expire at the cut-off; private-route headers (no tags, `no-referrer`); rate limits |
| Webhook forgery or confusion | Signature check; a `type:'addon_order'` branch re-checked against the database (amount, currency, status); idempotency through `stripe_webhook_events` |
| A slow invoice revision misses add-ons | Add-on changes mark the existing `invoice_sync_due_at` and use `withInvoiceLock`, so places and add-ons revise together |
| Overselling, or capacity locked up by holds | `SELECT … FOR UPDATE` on reservation; unpaid places are released at the cut-off (Q17b) or earlier by the organiser; a group can hold at most its roster size |
| A refund goes to the wrong party | Every refund uses the line's own payment intent, invoice or credit note |
| Personal data at Stripe | Ids only in metadata; invoice lines show counts (Q20); the D4 keys are removed |
| Exports over-share | Minimum fields per add-on. No free-text notes field on add-ons, because it attracts health data. Medical and dietary data aren't in add-on exports (rooms are out of scope) |
| Impersonation or support-mode writes | `assertNotImpersonating`; `assertWritable()` on new admin mutations |
| Agent injection through add-on titles | Rendered as plain text; treated as data (CLAUDE.md) |

### 5.3 Database

- **New tables:** RLS on; `REVOKE ALL FROM PUBLIC, anon, authenticated`; explicit grants to `service_role` and `tenant_app`; tenant policies.
- **Triggers:** `tenant_id` is derived on `event_addons` and `addon_orders`; lines inherit it via the parent.
- **Currency trigger.** Also `price_cents >= 0` and `capacity >= 0`.
- No health data is added, so no new encrypted columns are needed.

### 5.4 Privacy

- **Collection notice:** the registration and add-on screens say that names go to the named provider (hotel, SpaceX). This needs a privacy-policy line, after legal review.
- **Retention:** booking and payment records are kept 7 years. A deletion request anonymises the lines rather than deleting them. Exports are generated on demand and not stored. `docs/RUNBOOK-privacy-retention-and-deletion.md` gets a section.

---

## 6. Implementation plan

Each phase ships behind `ADDONS_ENABLED`, on dev first, with a production promotion that has its own yes. Sizes are relative: S < M < L.

### Phase R: remove account credits (M; added 17 Nov, owner)

Account credits are retired: the monetary credit issued in place of a cash refund and redeemed at a later Checkout. **Every trace is removed from the public website and the web app** as part of this work. Doing it **before Phase 3** means the add-on refund and Checkout code never has to handle credits.

**What exists today** (`git grep`, 17 Nov):

| Area | Where |
|---|---|
| Tables | `public.account_credits`, `public.credit_redemptions` (`baseline.sql:1744, 2318`; `20261012173639_credit_redemption_reservations.sql`) |
| Issuing credit (refund as credit) | `lib/refunds/execute.ts`, `preview.ts` (`refund_type = 'credit'`, `event_refunds.account_credit_id`); `lib/scholarship-refund.ts`, `lib/scholarship-offer.ts`, `lib/scholarships.ts`, `lib/scholarship-emails.ts`; admin `scholarships/[id]/{offer,refund}` routes; `components/admin/ScholarshipReview.tsx` ("Account credit" option); `entitlements.fn_cancel_cohort` (paid bookings "refunded to `account_credits` by the caller"), `lib/mentoring.ts` |
| Redeeming credit | `lib/refunds/redeem.ts` (reservations), `app/api/stripe/membership-checkout/route.ts`, the webhook (`finalizeRedemption`), `lib/entitlements.ts` (the "account-credit waterfall", `creditAvailableCents`), `app/api/community/mentoring/register/route.ts` (`creditAppliedCents`) |
| Showing credit | `components/account/EntitlementsSummary.tsx` ("Account credit" stat), `components/member/ScholarshipHistory.tsx` ("added as account credit"), `app/api/members/billing/route.ts` (`credits`), `lib/event-admin.ts` |
| Plumbing | `app/api/admin/members/merge/route.ts`, `lib/tenancy/registry.ts`, `scripts/verify-deletion-registry.mjs`, `lib/database.generated.ts`, `supabase/tests/database/{tenancy,s0_search_path_rls}.test.sql`, and the matching unit tests |
| Public website | No mentions found in public pages, Sanity content, emails or legal docs |

**Not account credits:** mentoring **session credits** are membership entitlements (`DiscoverGrid` "Use N session credits"). They stay unless the owner says otherwise (Q21).

**Steps:**
1. **Live balances: none.** The owner confirmed on 17 Nov that no account credit balances exist (Q22, Q23). The drop migration still checks this itself (step 5).
2. **Stop issuing.** Remove the `credit` refund type from the refund and scholarship code and the admin UI. Cash refund becomes the only option, with `manual_required` for exceptions.
3. **Stop redeeming.** Remove the reservation and redemption code from membership and mentoring checkouts, the webhook and the entitlements waterfall. Keep a webhook guard that logs (and does not fail on) any old session still carrying `creditReservationId` metadata, for one release.
4. **Stop showing.** Remove the UI, the billing API field and the email copy.
5. **Database (separate migration, after the code is on production):**
   - drop `credit_redemptions` and `account_credits`;
   - drop `event_refunds.account_credit_id` and the `entitlements.bookings.credit_applied_cents` / `credit_available` path;
   - update `fn_cancel_cohort`'s comment and behaviour.
   - The migration **refuses to run** if any credit row has a balance or any `credit_redemptions` row is `reserved`, as a cheap guard on the owner's confirmation.
   - If no `event_refunds` row has `refund_type = 'credit'`, `'credit'` is removed from the CHECK. If any exist, the value stays as history, and the code can no longer write it. The migration decides by counting.
6. **Plumbing:** the registry, the merge list, the deletion registry, generated types, pgTAP tests, and docs (runbooks and handovers that describe credits get a "retired 2026-11" note; archived handovers are left alone).

**Exit:**
- `git grep -i "account.credit\|credit_redemption\|account_credits"` finds only historical migrations and this plan.
- The full unit suite, pgTAP and e2e pass.
- Membership and mentoring checkouts are proven on dev with Stripe test mode.

### Phase 0: decisions (docs, S)
- §4 answered, and the decisions recorded in the register. Q1 to Q5 were answered on 17 Nov, so Phase 1 is unblocked.
- Threat model, DPIA and data-map drafts.
- Copy per `VOICE.md`.
- Baylor's tour and accommodation dates and cut-offs confirmed.

### Phase 1: schema and catalog, merch folded in (M)
**Migrations:**
- `event_addons`:
  - `id`, `tenant_id`, `event_slug`, `kind` (accommodation | experience | merch);
  - `title`, `description`, `includes text[]`, `service_date`, `service_end_date`;
  - `price_cents` (null for merch), `currency`, `capacity`;
  - `sale_opens_at`, `sale_closes_at`, `audience`, `refund_rule` jsonb;
  - `requires_addendum` (Q10, Q11), `display_group`, `sort`;
  - `status` (draft | on_sale | closed | archived), `created_by`.
- `event_addon_variants`: links a merch add-on to its `store_variants`.
- `event_addon_settings`: `event_slug`, `merch_upsell bool default true`, and what's included. An event with no row reads as upsell on.
- **Backfill:** each `event_store_offerings` row with `treatment = addon` becomes a merch add-on. Included shirts stay where they are and are shown as "What's included". `event_store_offerings` is kept, read-only, until Phase 6.
- **Grants, policies and pgTAP.**

**Code and UI:**
- `lib/addons/{catalog,eligibility,pricing}.ts`. Merch pricing delegates to `computeUnitPrice`.
- An admin "Add-ons" panel on `admin/competitions/[slug]` that **replaces `EventMerchandiseEditor`**, plus the merch upsell toggle. Routes under `app/api/admin/events/[slug]/addons/**`.
- **Public pages:**
  - the event card pill (accommodation and experience only);
  - "Optional extras" and "What's included" on the event page;
  - "Event merch" on the event page when the upsell is on.

  A new `@stellr/web-ui` `AddonCard` with a story.

**Exit:** Baylor's add-ons are set up on dev, the public page is correct, existing merch add-ons are unchanged for buyers, and the isolation suite is green.

### Phase 2: bookings, holds and individual payment (L)
**Migrations:**
- `addon_orders`: `id`, `tenant_id`, `event_slug`, `registration_id`, `payer_kind`, the payer, `method`, `status`, `total_cents`, `currency`, the Stripe ids, `pay_token`, `expires_at`, `paid_at`.
- `registration_addons` (lines):
  - `participant_id`, `addon_id`, `variant_id`, `quantity`, `order_id`, `unit_price_cents`, `currency`;
  - `payer`, `status`, `held_until`, `booked_by_*`, `cancelled_*`;
  - `store_order_item_id`, `refund_id`.
- `reserve_addon()`, a locking function.

**Code:**
- The **"Add extras" page** for organisers and individuals, reachable from the confirmation page, the member event page and Account:
  - pick add-ons;
  - tick people;
  - choose sizes (merch);
  - choose the payer;
  - then reserve.
- **Group by card:** a Checkout for the add-on lines only.
- **Each person pays:** an add-on order per payer, a pay page at `/register/[slug]/addons/pay/[token]` (no account needed), and emails to the student and the guardian.
- **Organisers choose** (US-12, US-16, US-17): teachers, Teacher POCs and student managers book for ticked members, with the student-manager invoice rule from Q19. Members buy only their own merch (US-17a).
- **Webhook:**
  - an `addon_order` branch, which confirms the lines and creates `store_order_items` for merch;
  - `checkout.session.expired` clears the dead session from the order so the pay link makes a fresh one. It **doesn't** release the place: under Q17b, an unpaid place is kept until the cut-off.
- **Exit:** on dev, a registered group books two nights by card and the tour by each person, and a member buys merch in their size. Webhook replay tests pass.

### Phase 3: invoices and registration Extras step (L)
**Invoices (US-20):**
- `group_invoice_lines` (`seat | addon`), backfilled from existing `group_invoices` as seat lines.
- `draftWithLine` becomes "draft with lines".
- `reviseGroupInvoice` adds and removes add-on lines.
- The `addons` invoice kind.
- `perSeatPaidCents` and the refund basis read seat lines.
- Line-level coupons.
- Add-on changes mark `invoice_sync_due_at`.
- Q5 path.

**Registration forms:**
- **Individual form:** one "Extras" step holds merch and the other add-ons. The D1 coupon fix; `amount_due_cents` includes add-ons (D3); the D4 metadata keys are removed; D5 routes through the helper.
- **Group form:** an optional "Extras" step after the roster (merch included, D7). It creates add-on bookings once the registration is saved, using Phase 2's machinery. Lines paid by the group go onto the invoice just created.
- Tenant mirror pages don't mount the step (FR-1).

**Exit:** invoice revision and add-ons-only invoices pass tests against Stripe test mode, and an invoiced group's place refund amount is unchanged by add-on lines.

### Phase 4: cancellations and refunds (M)
- `cancelParticipantAddons` is wired into `executeDeletion`, `applyRosterChange`, staff cancel and the event-cancel batch. This fixes D2.
- Refund rules (Q8), credit notes, the merch rule tied to the batch commit.
- **Unpaid places** (Q17b), handled inside the existing daily `group-invoice-sync` cron (no new cron):
  - a reminder to the organiser and the student 7 days before the cut-off;
  - at the cut-off, still-unpaid lines become `expired` and their places are released.
- **Exit:** every refusal and cascade in §3 has a test.

### Phase 5: member pages and operations (M)
- **Member pages:** add-ons, merch included, shown together:
  - the member event page;
  - Account / Billing (`BillingHistory`, `OrdersList`, `MyRegistrations`);
  - the Teams tab, with an add-ons column and the payer per line.
- **Admin:** the roster column, CSV columns, per-add-on exports (US-7), check-in ticks for all kinds (US-23), dashboard counts, and staff actions (US-6).
- **Emails:** itemised confirmation, receipt, the organiser's "opted in and paid" note, and an expiry warning.
- **Exit:** a staff dry run on dev with Baylor's set-up.

### Phase 6: retire the old merch path (S)
- Remove `merch_addons` from the individual flow, `prepareRegistrationAddons` and `pendingAddonLines`.
- Make `event_store_offerings` read only for included shirts, or migrate those to `event_addon_settings`.

### Order against Baylor's dates

1. **Phases 1 and 2 first.** They serve everyone who registers before 18 Dec. Phase R runs beside them. It touches checkout and refund files, so it must land before Phase 3.
2. **Then Phases 3 to 5.** These should be live by the earlier of the tour's names deadline or mid-February 2027.
3. **Phase 6 last.**

Accommodation for minors opens for sale only once the December overnight addendum is live (FR-5b).

### Files touched outside the new paths

| File | Change | Lane |
|---|---|---|
| `lib/group-billing.ts`, `lib/group-invoice.ts` | invoice lines, revise, `addons` kind, sync | A / C |
| `lib/refunds/payment-basis.ts`, `execute.ts` | seat lines only; add-on lines | A |
| `app/api/stripe/webhook/route.ts` | `addon_order` dispatch, session `expired` clean-up; invoice paid for `addons` | A |
| `lib/registration-checkout.ts`, `lib/registration/individual/*`, `group/respond.ts` | Extras step, D1, D3, D4, D5 | A |
| `lib/store/event-merch.ts` | delegate to add-ons; later retired | A |
| `lib/deletion/execute.ts` | cascade | A |
| `components/forms/IndividualRegistrationForm.tsx`, `GroupRegistrationForm.tsx` | Extras step | A |
| `components/admin/EventMerchandiseEditor.tsx` → new Add-ons panel; `EventRoster.tsx`; check-in | admin | C |
| `components/member/TeamsTab.tsx`, `BillingHistory`, `MyRegistrations`, `components/account/OrdersList.tsx` | member pages | A / C |
| `app/(stellr)/(public)/events/[slug]/page.tsx`, `components/ui/EventCard.tsx` | public | B |
| `lib/email.ts` | templates | B |
| `docs/THREAT-MODEL.md`, compliance docs, runbooks | §5 | D |

### Tests

- **Unit:** pricing (with merch through `computeUnitPrice`), eligibility, capacity, refund rules, payer routing (an invoiced place with a self-paid tour), and the invoice line plan (unpaid → revise; paid → add-ons invoice).
- **pgTAP:** isolation, the currency trigger, grants, the capacity race, and the "RLS on, no policy" rule.
- **Stripe test mode:** invoice revision with mixed lines, line-level coupons, credit notes.
- **Webhook replay:** duplicates, a wrong amount, an expired Checkout session, payment after the cut-off released the place.
- **IDOR generator** on the new routes.
- **e2e:** a group adds extras after registering; signed-out self-pay; a withdrawal refunds each line to its payer; the merch upsell shows on and off.

---

## 7. Risks

| Risk | Rating | Mitigation |
|---|---|---|
| Changing group invoices from one line to many breaks the seat maths and refunds | **High** | `group_invoice_lines` first, with a backfill and tests proving every existing refund amount is unchanged before add-on lines exist |
| Baylor's timeline compresses review of money code | High | Post-registration path first; flag per event; a staff dry run; promotion with its own yes |
| Folding merch in breaks today's merch buyers or the Printful batch | Medium | Backfill plus parallel read in Phase 1; the old path is removed only in Phase 6; store order items are still produced |
| Collisions with S5 wave 8 in Lane A files | Medium | New paths; shared-file hooks as small PRs coordinated with the wave 8 handover |
| Minors overnight and off-site | High | Q9 and Q10 answered: group-only for minors, plus the overnight addendum (December). Sales to minors open only once it's live |
| Removing account credits breaks membership or mentoring checkout, or strands a live balance | Medium | The owner checks balances first; code removal before the drop; the migration refuses while any balance remains; Stripe test-mode proofs |
| Data shared with the hotel and SpaceX without notice | Medium | Collection notice; minimal exports; data map |
