# Handover: remove an educator video testimonial (21 Nov 2026)

**Committed and merged to `dev`; NOT promoted.** The owner will promote separately.

## Context

The owner asked for one educator's video testimonial to be removed from the public site, with all traces gone. The person's name and the Blob paths are in the Doc snapshot, not here, because the repo is public.

## What changed (#833, `9127bc0a`)

- `app/(stellr)/(public)/why-stellr/page.tsx`: the video `<figure>` under the Teachers CTA buttons is gone, with the `VideoTestimonial` and `VIDEOS` imports only it used.
- `lib/media-manifest.ts`: the clip's `VIDEOS` entry is gone. It held the person's name and organisation in its title.
- `docs/handovers/HANDOVER-vercel-deployment-storage-2026-09-21.md`: the size-table row reads "(an educator clip since removed)", matching the earlier removed mentor clip.

## How it was checked

- `git grep` for the name, nickname and slug: no hits left in tracked files (one false hit is a base64 hash in `package-lock.json`).
- Sanity: a GROQ `match` on the name over body/title/name/quote/text/author/description returned nothing. That covers the common text fields, not every field.
- CI on #833: all checks passed; the steps ran, including `e2e-tests / Run npx playwright test`.
- Not checked: the page in a browser. The diff only removes a block, and typecheck/build passed.

## Open (tracker `2026-11-21-remove-educator-video.md`)

1. `remove-educator-video.1`: promote; then confirm on production.
2. `remove-educator-video.2`: delete the 9 Blob files **after** promotion, with the owner's yes. They are permanent deletes.
3. `remove-educator-video.3`: the name is in public git history; rewrite only if the owner needs it.
