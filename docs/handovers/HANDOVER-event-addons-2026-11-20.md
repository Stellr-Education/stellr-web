# Handover: event add-ons + account credits retired (17–20 Nov 2026)

Slug `event-addons`. Tracker: `tracker/2026-11-20-event-addons.md`. Plan: `docs/PLAN-event-add-ons-2026-11-17.md` (Q1–Q23 answered there).

## What shipped (all in production)

Event add-ons (accommodation, experiences, merch) for registered attendees, and the full retirement of account credits.

| PR | What | On dev | Promoted |
|---|---|---|---|
| #782 | Phase 1: schema, admin Add-ons panel, public extras | `bce9b509` | #806 |
| #783 | Phase 2: book after registering, card and pay links | `fed58c96` | #806 |
| #785 | Credits step 1: stop issuing, redeeming, showing (expand) | `130d515e` | #806 |
| #786 | Phase 3: add-ons on group invoices, Extras step in registration | `79aeb4bd` | #806 |
| #787 | Phase 4: cancellations, refunds, unpaid-place sweep | `f2404b53` | #806 |
| #789 | Phase 5: staff tools, manifest CSV, check-in, member links | `509f9cc7` | #806 |
| #790 | Phase 6: old merch add-on path retired | `12c2ba64` | #806 |
| #791 | Credits step 2: drop tables, columns, old functions (contract) | `1e3a354e` | #811 |
| #809 | Keep the one historical credit refund as history | `710996b7` | #811 |

- #806 merged to `main` as `14580ac6` (production `dpl_Hc8bLLAKRFi9ic2mMpsDPaVXaY9d`). Records: `.claude/releases/promote-2026-11-20.md` via #807.
- #811 merged as `c7ccc66e` (production `dpl_5asV71CVbMcg6ZvrvTFCkSy1MHE9`). Record via #814.
- Six migrations reached production through the Production migration Action before each merge, each owner-approved: `20261117182507_event_addons`, `20261117185900_retire_account_credits`, `20261117191230_group_invoice_addons`, `20261117193834_addon_check_in`, `20261117195010_retire_merch_addon_offerings`, `20261117195245_retire_account_credits_contract`.

## Decisions made during the session

- Extras are never in the registration Checkout (so promotion codes and scholarship coupons never discount them). They are paid by their own card link, or on the group's invoice: the unpaid main invoice is revised; once it is paid, an add-ons-only invoice is issued (US-20).
- Invoice lines name the add-on and a count, never a person (Q20).
- Minors' overnight lines wait for the December addendum: `ADDON_ADDENDUM_TEMPLATE` is unset, so nothing waits on a signature yet.
- Production held one past refund issued as account credit (its credit fully used, no balance). The contract migration refused on it and rolled back; the owner chose to keep it. `event_refunds_refund_type_check` allows `credit` only on rows created before 2026-11-20.

## Not verified

- No add-on has been bought, invoiced, cancelled or refunded in production: none is on sale yet. Those flows were tested on dev with Stripe test mode only.
- The plan required the threat model, minors DPIA and data map to be updated in the same PR as the first migration. That was not done; it is row `event-addons.1`.

## Lessons for the next stacked ship

- After a squash, `git rebase --update-refs` left the middle branches pointing at old commits. Repoint each branch by commit count with `git branch -f`.
- Right after a push, `gh pr checks` can show the old head's results. Confirm `headRefOid` and `mergeable` first.
- The prod-migrate Action keeps one pending run (concurrency group), so dispatch migrations one at a time.
- The Action logs only the SQLSTATE of a refusal. A `P0001` from a guard needs a read-only query by the owner to find which guard fired.

## Open items

See the tracker. The most important: `event-addons.1` (compliance docs) and `event-addons.2` (Baylor's add-ons).
