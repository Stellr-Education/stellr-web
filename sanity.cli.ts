import { defineCliConfig } from 'sanity/cli'

// Sanity CLI settings for the hosted Studio (docs/RUNBOOK-sanity-studio.md).
// `npx sanity deploy` builds sanity.config.ts and publishes it to
// https://<SANITY_STUDIO_HOSTNAME>.sanity.studio.
//
// No default hostname: a guessed name could claim the wrong one, and a hostname
// cannot be renamed once taken. Unset, the CLI asks for one when it deploys.
// After the first deploy the CLI prints an app id; set SANITY_STUDIO_APP_ID to it
// so later deploys go to the same Studio without asking.
const projectId = process.env.SANITY_STUDIO_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
const studioHost = process.env.SANITY_STUDIO_HOSTNAME || undefined
const appId = process.env.SANITY_STUDIO_APP_ID || undefined

export default defineCliConfig({
  api: { projectId, dataset },
  studioHost,
  ...(appId ? { deployment: { appId } } : {}),
  // The Studio's build is Vite, whose default copies ./public into the output.
  // That folder is the site's (team photos, the check-in service worker, email
  // images); the Studio needs none of it.
  vite: (config) => ({ ...config, publicDir: false }),
})
