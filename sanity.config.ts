import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './sanity/schemas'

// The Studio is hosted by Sanity (`npx sanity deploy`, docs/RUNBOOK-sanity-studio.md),
// not served by the Next app: the embedded /studio route put about 10 MB in the
// function bundle (Vercel retention .6). The CLI reads this file through
// sanity.cli.ts and builds the Studio from it.
//
// The deployed Studio is a browser bundle, and Sanity's build only inlines
// variables named SANITY_STUDIO_*, so those come first. The NEXT_PUBLIC_* names
// cover `npx sanity dev` and the CLI's own commands, which read .env.local as
// the app does.
const projectId = process.env.SANITY_STUDIO_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || ''
const dataset = process.env.SANITY_STUDIO_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

export default defineConfig({
  name: 'stellr-web',
  title: 'Stellr Education',
  // Served at the root of its own host now, not under the app's /studio.
  basePath: '/',
  projectId,
  dataset,
  plugins: [
    structureTool(),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
  },
})
