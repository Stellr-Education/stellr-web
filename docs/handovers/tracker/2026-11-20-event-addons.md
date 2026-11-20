# Event add-ons + account credits retired — 2026-11-20

Slug: `event-addons`. Handover: `HANDOVER-event-addons-2026-11-20.md`. Doc snapshot: `1HeEGSUcl41n7Yx12fjZaWP0aflHv-Mu8VloQt1IRCfk`.
PRs #782, #783, #785, #786, #787, #789, #790 → `dev`, promoted in #806 (`14580ac6`); #791, #809 → `dev`, promoted in #811 (`c7ccc66e`). Migrations: 6, all applied to production via the Action before the code.

Event add-ons are live for attendees, and account credits are fully retired. No add-on is on sale in production yet.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| event-addons.1 | Threat model, minors DPIA and data map for add-ons | Not updated. The plan required them with the first migration (plan §5, line 311); add-ons collect overnight-stay and experience data about minors and may share it with a hotel and tour operator | Draft the `docs/THREAT-MODEL.md` entries, the DPIA section and data-map rows; owner review | ☐ |
| event-addons.2 | Baylor (Texas, 6 Mar 2027) add-ons | Not set up in production; registration closes 18 Dec 2026 | Owner gives prices, capacities and cut-offs; create the three add-ons in the admin Add-ons panel | ☐ |
| event-addons.3 | First live add-on payment | No add-on bought, invoiced or refunded in production; tested on dev with Stripe test mode only | When Baylor's add-ons are on sale, watch the first card payment and first invoice revision (webhook `addon_order`, `group-invoice-sync`) | ☐ |
| event-addons.4 | December overnight-consent addendum | Owner developing it in December; `ADDON_ADDENDUM_TEMPLATE` unset, so no minor's overnight line awaits a signature | Once the addendum template exists, set the env var and confirm minors' accommodation lines move to `pending_consent` | ☐ |
| event-addons.5 | Account credits retired | Live: #811 `c7ccc66e`; credit tables dropped on production (Action run 44766950193); one historical credit refund kept | — | ☑ |
| event-addons.6 | Add-ons for other tenants (ASDC) | Out of scope by owner decision (US-24): AUD, Fri/Sun nights wait for S8/S9 | Pick up with the tenant stages | ☐ |
