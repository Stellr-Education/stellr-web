# Remove an educator video testimonial — 2026-11-21

Slug: `remove-educator-video`. Handover: `HANDOVER-remove-educator-video-2026-11-21.md`. Doc snapshot: `1uqd0cN1EPPBWm1V3EsSHdy_lDX5D-u0pwo-dsL-1Klw`.
PR #833 → `dev` as `9127bc0a`; not promoted. Migration: none.

At the owner's request, one educator video testimonial is gone from the `/why-stellr` Teachers section, from `lib/media-manifest.ts` (`VIDEOS`) and from a row in the 21 Sept storage handover. Who it was is in the Doc only.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| remove-educator-video.1 | Video off the live site | On `dev` (`9127bc0a`); CI green, Playwright step ran. Production still shows it. Owner promotes separately. | Promote; then open `/why-stellr` on production and confirm the Teachers section has no video. | ☐ |
| remove-educator-video.2 | Delete the clip's files from Vercel Blob | 9 files remain (current `videos/2026-10/` set: mp4, vtt, jpg poster, 3 webp posters; September `videos/` set: mp4, vtt, poster). Anyone with a direct URL can still open them. Paths in the Doc. | After .1 is live, owner confirms, then `del()` the 9 paths with `@vercel/blob` and list again to check none remain. Deleting first breaks the live player. | ☐ |
| remove-educator-video.3 | Name still in public git history | Older commits (e.g. #129, #420, #439) contain the person's name in the manifest. The repo is public. | Owner decides. Default: no history rewrite. | ☐ |
