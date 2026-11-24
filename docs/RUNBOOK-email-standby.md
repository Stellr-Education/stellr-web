# Runbook: switching email to the Amazon SES standby

Email plan Workstream F (owner decision, 23 Nov 2026): Resend is the only live sender. Amazon SES is a **warm standby**, switched on by a person when Resend can't send, and switched off again the same way. Nothing switches automatically.

## When to switch

Switch to SES if either is true:
- Resend is down or refusing every send for **more than 1 hour**. Check the Resend status page and the admin dashboard's mail health; the email outbox's waiting count climbs.
- The Resend account is **paused or suspended** (Resend emails the account owner, and every send fails).

Don't switch for one bad message, a rate limit, or the plan's monthly cap. The outbox already waits those out.

## What happens while SES is on

- **Transactional mail goes through SES**: registration, consent, credentials, receipts, event logistics, and tenant event mail.
  - It sends from `mail.stellreducation.org` (MAIL FROM `ses.mail.stellreducation.org`).
  - A tenant with its own domain shows as "\<Tenant\> via Stellr" for the duration, and replies still go to the tenant.
- **Community mail is held in the outbox**: campaigns and promotional event emails. It sends through Resend once you switch back.
- **Bounces and complaints**: SES sends them to the SNS topic, then to `/api/webhooks/ses`, then into `email_events` and the suppression list, as Resend's do.
- **Open and click tracking:** none while on SES.
- **Idempotency:** SES has no idempotency key. The outbox's row claim prevents double sends from the queue, and live sends are only made once.

## How to switch on

1. In Vercel, open the **stellr-web** project and set Production env var `EMAIL_PROVIDER` to `ses`:

   ```bash
   vercel env add EMAIL_PROVIDER production --value ses --yes --project stellr-web --scope stellreducation
   ```

2. Redeploy production so it takes effect: Vercel, Deployments, the current production deployment, Redeploy.
3. Send yourself a test: any transactional email, such as an admin "send test" event email. Check it arrives and shows `via amazonses.com` in its headers.
4. Watch the first hour:
   - `email_events` should get `provider = 'ses'` rows;
   - the admin dashboard's mail health should show no failures;
   - check the SES reputation: `aws sesv2 get-account --profile stellr --region us-east-2`.

## How to switch back

1. Remove the variable:

   ```bash
   vercel env rm EMAIL_PROVIDER production --yes --project stellr-web --scope stellreducation
   ```

2. Redeploy production.
3. The next email-outbox cron run (every 6 hours, or run it by hand) sends the held community mail through Resend.

## The AWS pieces (account 931017478540, us-east-2, tag `purpose=email-standby`)

| Piece | Name |
|---|---|
| SES identity | `mail.stellreducation.org` (production access, 50,000 a day, 14 a second) |
| Configuration set | `stellr-email-standby`, which sends SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT and DELIVERY_DELAY events to SNS |
| SNS topic | `arn:aws:sns:us-east-2:931017478540:stellr-ses-events` (only SES in this account may publish) |
| SNS subscription | HTTPS to `https://app.stellreducation.org/api/webhooks/ses`, added after the webhook is in production |
| OIDC provider | `oidc.vercel.com/stellreducation` (audience `https://vercel.com/stellreducation`) |
| IAM role | `stellr-ses-standby`: `ses:SendEmail` and `ses:SendRawEmail` on the identity and configuration set only. It can be assumed only by the production environments of `stellr-web` and `stellr-web-dev`. |

Vercel env vars, set on both projects: `SES_ROLE_ARN`, `SES_SNS_TOPIC_ARN`, `SES_REGION=us-east-2`, and optionally `SES_CONFIGURATION_SET` (default `stellr-email-standby`).

## Quarterly drill (dev)

The dev project is behind Vercel Authentication, so SNS can't reach its webhook. The drill checks sending, and the bounce path is checked in production after promotion.

1. Set `EMAIL_PROVIDER=ses` on **stellr-web-dev** and redeploy dev.
2. Send 5 test emails (they go to `DEV_EMAIL_SAFELIST`). Confirm they arrive, then confirm the SES console's sending statistics show 5 sends.
3. Remove `EMAIL_PROVIDER` from dev and redeploy.
4. **Production only, once a quarter:** send one email to `bounce@simulator.amazonses.com` while on SES during a planned window. Confirm a `bounced` row with `provider = 'ses'` appears in `email_events`, and the address appears in `email_suppressions`. <!-- pii-ok: AWS SES mailbox simulator address, not a person -->

Record each drill in the email-standby tracker rows.

## When to make SES the main sender instead

Any one of:
- Resend has an outage of more than 4 hours, or a pause, **twice in 12 months**;
- volume passes 50,000 a month;
- more than 8 Resend domains are in use.
