# Agreement signer status lines — 2026-11-22

Slug: `signer-status`. Handover: `HANDOVER-signer-status-2026-11-22.md`. Doc snapshot: `1yTcGOM8IOTWUTLyJUaNBPR_ItgTo61bnETZ0zEU2Dhk`.
PR #891 → `dev` as `30b9cf0a`; NOT promoted (owner promotes separately). Migration: none.

Agreement cards show one colour-coded status line per signer while signing is in progress (member portal / View as, admin member panel). The bounced sentence names who has signed, and the footer no longer promises a reminder on bounced forms.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| signer-status.1 | Promote #891 to production | On `dev` (`30b9cf0a`); all CI green, e2e and Storybook axe steps ran. Not on `main`. | Owner promotes with the next `promote` run. No migration needed. | ☐ |
| signer-status.2 | Student signature on the consent form that started this (names in the Doc) | Checked in DocuSign 22 Nov: Guardian signed 17 Nov; Minor `autoresponded` (bounce Permanent General) at a school-domain address. Envelope still `sent`. | Owner: Correct email on the event roster with a non-school address for the student. The Guardian's signature is kept. | ☐ |
| signer-status.3 | See the new lines with real data | Checked only in Storybook (fictional data), desktop and 375px. The admin `MemberAgreementPanel` was not rendered at all; the roster and admin table only changed sentence text. | After promotion, open the affected member's View as and a mentor's admin member page; confirm the lines and the signed date. | ☐ |
| signer-status.4 | Member-facing bounce hint wording | Shipped as "Signatures already given are kept. Contact us to correct the address." Chosen by the session, not by the owner. | Owner confirms or rewords (`components/member/DocusignsSection.tsx`). | ☐ |
| signer-status.5 | Expiry line contrast | `green-600` (≈3.3:1) failed axe on the first CI run; now `text-enviro-green-text`. Verified by the Storybook axe step on #891. | — | ☑ |
