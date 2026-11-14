# Runbook: hosted Sanity Studio and the signed event-sync webhook

**Owner action. Do not promote the PR that removes `/studio` until steps 1 to 4 are done and the hosted Studio opens.**

Review ids: Vercel retention .6, legacy 6.5 (Studio out of the app bundle), deep review v2 .12 (signed event-sync webhook), deep review v2 .16 (`lib/sanity` server-only).

## What changed

The Studio used to run inside the Next app at `/studio`. That one route put about 10 MB into the function bundle that every deployment ships. It now runs on Sanity's own hosting, at `https://<hostname>.sanity.studio`, built and published by the Sanity CLI.

- `app/(stellr)/studio` is gone. Without `NEXT_PUBLIC_SANITY_STUDIO_URL`, `/studio` is the normal 404.
- With `NEXT_PUBLIC_SANITY_STUDIO_URL` set at build, `/studio` and everything under it redirect (307) to the hosted Studio, so bookmarks keep working. Stellr's hosts only; a tenant host keeps its own 404.
- The site's Content-Security-Policy no longer allows the Sanity API hosts. Only the Studio called them from a browser.
- `sanity.cli.ts` holds the CLI settings. `sanity.config.ts` is still the Studio's config, now served from `/` on its own host.

## Schema changes now need two deploys

A change under `sanity/schemas/` reaches editors only when the Studio is redeployed:

1. Merge and deploy the app as usual (Vercel). The site's queries and types follow the code.
2. Run `npx sanity deploy` from an up-to-date checkout of the same commit. Editors see the new fields after it finishes and they reload the Studio.

Deploy the app first when a field is added, so the site can read it before anyone fills it in. When a field is removed, deploy the Studio first, so editors stop writing to it.

## 1. Choose the hostname

The Studio's address is `https://<hostname>.sanity.studio`. A hostname cannot be renamed once taken, so pick it deliberately. `sanity.cli.ts` sets no default: it reads `SANITY_STUDIO_HOSTNAME` and, without it, the CLI asks.

## 2. First deploy

From the repo root, on a checkout of the commit you are releasing, signed in to the Sanity account that owns the project (`npx sanity login` if needed):

```sh
SANITY_STUDIO_HOSTNAME=<hostname> \
SANITY_STUDIO_PROJECT_ID=<project id> \
SANITY_STUDIO_DATASET=production \
npx sanity deploy
```

- The project id is the value of `NEXT_PUBLIC_SANITY_PROJECT_ID` (not a secret; it is already in the site's pages).
- The `SANITY_STUDIO_*` names matter: the deployed Studio is a browser bundle, and Sanity's build inlines only variables with that prefix. `NEXT_PUBLIC_*` values are not carried into it.
- The CLI prints an app id after the first deploy. Keep it as `SANITY_STUDIO_APP_ID` for later deploys, so they go to the same Studio without asking. Newer CLI versions prefer the app id to `studioHost`; both are read.
- Do not add a `package.json` script for this in the same PR; `npx sanity deploy` is the command.
- The CLI leaves two folders in the checkout that git does not ignore yet: `dist/` (the built Studio) and `.sanity/` (its cache). Delete both afterwards and do not commit them. A follow-up adds them to `.gitignore`.
- `sanity.cli.ts` stops the build copying the site's `public/` folder into the Studio, so the Studio carries only its own files.

## 3. Check CORS

The Studio signs editors in and calls the project API from its own origin. `sanity deploy` normally adds `https://<hostname>.sanity.studio` to the project's CORS origins. Confirm it:

```sh
npx sanity cors list
```

If the hosted origin is missing, add it with credentials allowed:

```sh
npx sanity cors add https://<hostname>.sanity.studio --credentials
```

The existing entries for `https://www.stellreducation.org` and `https://app.stellreducation.org` served the embedded Studio. Leave them until the hosted Studio has worked for a week, then remove the credentialed ones: the site itself reads Sanity only from the server.

## 4. Point the app at it

Set `NEXT_PUBLIC_SANITY_STUDIO_URL=https://<hostname>.sanity.studio` on both Vercel projects: `stellr-web` (production) and `stellr-web-dev` (development). It is read at build, so redeploy each project after setting it. Then open `https://www.stellreducation.org/studio` and check it lands on the hosted Studio.

Unset or not an `https://` URL, there is no redirect, and `/studio` is a 404.

## 5. Tell editors

The new address is `https://<hostname>.sanity.studio`. They sign in with the same Sanity account as before.

## Known gap: the slug-rename guard

The event schema's slug field asks the app whether a rename would strand database rows (`sanity/schemas/event.ts` calls `/api/admin/events/slug-guard`). That call is relative and relies on the editor's Stellr session cookie. On the hosted Studio it goes to Sanity's host, fails, and the guard lets the rename through (it fails open by design). Until a follow-up gives the hosted Studio a way to reach that check, `npx tsx scripts/audit-event-slugs.ts` is the only backstop. Tell editors not to rename a published event's slug, and run the audit after any rename.

## Scripts that read Sanity (deep review v2 .16)

`lib/sanity.ts` now starts with `import 'server-only'`, so a client component that imports it fails the build. Plain Node refuses that import too. A script that loads `lib/sanity` directly or through `lib/events/repo` must run with the React server condition:

```sh
npx tsx --conditions=react-server scripts/<script>.ts
```

That covers `notify:event-waitlist`, `hubspot:sync-event-options`, `sync:event-spaces`, `scripts/backfill-events-mirror.ts`, `scripts/backfill-lp-locations.ts`, `scripts/seed-two-tenants.ts` and CI's `scripts/lighthouse-urls.ts`. Until a follow-up adds the flag to those `package.json` scripts and the Lighthouse step, call `npx tsx --conditions=react-server` yourself instead of `npm run`.

## Signed event-sync webhook (deep review v2 .12)

`POST /api/admin/sanity/event-sync` accepts a request when either holds:

1. **Signed**: a valid `sanity-webhook-signature` made with `SANITY_WEBHOOK_SECRET` (checked with next-sanity/webhook).
2. **Header** (legacy): `x-webhook-secret` equal to `SANITY_WEBHOOK_SECRET`.

Either way, the route re-reads the event from Sanity by its `_id` and syncs that copy. The payload's fields are not used. If the read fails or returns an older revision, the route answers 503 and Sanity retries. Each accepted request logs `[event-sync] authorised by signature` or `[event-sync] authorised by x-webhook-secret header`, never the secret.

To switch the live webhook to signed delivery:

1. In Sanity, open **API → Webhooks**, then the event-sync webhook for the deployment it calls.
2. Set its **Secret** to the value of `SANITY_WEBHOOK_SECRET` on that Vercel project. Leave the `x-webhook-secret` header in place for now.
3. Publish a test change to an event. In that project's Vercel logs, check for `authorised by signature`.
4. After a few days of only `authorised by signature`, remove the `x-webhook-secret` header from the webhook.
5. A follow-up PR then drops the header path from the route.

If both projects receive the webhook, repeat for each, each with its own project's secret.
