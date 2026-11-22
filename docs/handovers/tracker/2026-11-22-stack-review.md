# Stack review follow-through (F1–F5) — 2026-11-22

Slug: `stack-review`. Handover: `HANDOVER-stack-review-2026-11-22.md`. Doc snapshot: `1G5QGxC2ifRTfpvyb81BVvGMZU5rPlRlr0sbPemmrov8`.
PRs #854, #856, #858, #876, #878, #879 → `dev` (latest `e503822f`); **not promoted** (owner hold, 22 Nov). Migration: none from this session (the pending one is #860's readiness lock).

Backups (F1) installed and proven on production data; SES (F3) approved in us-east-2; step-up (F4) on dev only; middleware CPU fix and Next 16.4.6 on `dev`; Vercel team on Pro after the Blob store was suspended.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| stack-review.1 | Promote `dev` to `main` | On hold by the owner, 22 Nov. `dev` carries #856, #858, #878 and #860's migration `20261122020000_tenancy_readiness_lock.sql`, not yet in production | When the owner says go: Production migration Action for that file (owner approves), then the promote skill | ☐ |
| stack-review.2 | F4 step-up in production | `ADMIN_STEP_UP_ENFORCE=true` on dev only since 22 Nov; verified on dev (403 → reverify → 200) | After about a week on dev and the promotion, owner decides; set the production variable and redeploy | ☐ |
| stack-review.3 | Admin MFA gate | `ADMIN_MFA_ENFORCE` off; Clerk Free refuses MFA | Revisit if Clerk Pro is bought (nonprofit request pending) | ☐ |
| stack-review.4 | Middleware CPU after #856 | Merged to dev 22 Nov; not in production. Before: middleware ~38% of Active CPU | A week after promotion, re-read Usage → Fluid Active CPU by type (1 Dec scheduled task checks) | ☐ |
| stack-review.5 | E-sign Drive drill beside the backup drill | Not run. Backup drill's audit anchor 22 Nov: `cc504b579ee6…` | Owner runs `scripts/esign-restore-drill.ts` (RUNBOOK-backups §8) and compares the anchor; record in §7 | ☐ |
| stack-review.6 | R2 lifecycle delete ages | Lock rules seen (8/35/35 days); lifecycle ages not seen | Owner checks each lifecycle rule deletes after the same days as its lock | ☐ |
| stack-review.7 | Backups Actions minutes | GitHub Free, 2,000/month; expected ~1,650; nonprofit Team plan applied for | Check Settings → Billing on 1 Dec (scheduled task) | ☐ |
| stack-review.8 | December restore drill | First drill PASS 22 Nov (RUNBOOK-backups §7) | Owner runs RUNBOOK-backups §4 in December; record it | ☐ |
| stack-review.9 | SES as the email fallback | Production access approved, us-east-2; nothing wired into the app; bounce/complaint handling promised on the request form | Plan on 1 Dec (scheduled task), then build with SNS bounce/complaint handling if the owner says yes | ☐ |
| stack-review.10 | AWS account hygiene and credits | Credits paid via TechSoup, coupon awaited; root MFA and $10 budget unconfirmed | Owner redeems the coupon, confirms MFA and the budget | ☐ |
| stack-review.11 | Vercel Pro spend | Team on Pro since 22 Nov after the `stellr-media` Blob store was suspended (Hobby quota); spend limit advised, not confirmed | Owner sets Spend Management; 1 Dec task reviews usage and whether moving media to R2 would allow a return to Hobby | ☐ |
| stack-review.12 | Nonprofit pricing replies | Clerk and Supabase emailed; Sanity discount applied for on the account; Resend, GitHub, Better Stack applied | Check replies before buying Clerk Pro or Supabase Pro | ☐ |
| stack-review.13 | Backups install (F1) | Installed 22 Nov; first runs green; restore drill PASS; skip alarm proven (RUNBOOK-backups §7, #876, #879) | — | ☑ |
| stack-review.14 | SES DNS and production access (F3) | Five records verified at both GoDaddy nameservers; production access approved | — | ☑ |
| stack-review.15 | Blob store restored | `stellr-media` read `available`, billing active; all 16 homepage media files returned 200 after the Pro upgrade | — | ☑ |
