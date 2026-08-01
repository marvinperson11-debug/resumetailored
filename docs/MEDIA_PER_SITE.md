# Media is scoped to the site now, not the account

**42+ new test assertions, 15 dependency-free files + 272 + 48 browser assertions, 0 failures.**

---

## What was actually happening

You had it right: uploads were saved into an account-wide "folder" (the `site_media` table, keyed only by your email), shared across **every** site you've ever built with the Website Creator. Try a template, upload a demo video to see how it looks, decide against that template and move to a different one — that video never left the pool. It just sat there, invisible on the site you're actually working on, quietly spending one of your 5 video slots forever.

So "first time testing out the video, hit my limit" was real and made total sense once I saw it: the cap was correct, it just wasn't counting the right thing.

## What changed

**Media now belongs to the specific site it was uploaded on.**

- Added `site_media.site_sub`, tying every upload to one site's subdomain. Every route that touches media (`GET`/`POST /api/site-media`, the Uploads panel, the text-video generator, the voice recorder) now requires a site to attach to — sourced from whichever site you have open in the editor.
- **Delete a site → its media goes with it.** Files unlinked from disk, rows dropped. No more orphaned uploads outliving the site that used them.
- **Rename a site → its media follows.** A rename isn't a delete-and-recreate, so the photos and videos already on the page don't vanish or get miscounted as "new" against the renamed address.
- **The old "delete my site" route** (the one from before multiple sites existed) now wipes media for every site under the account, matching what "delete everything" has always meant there.
- The cap itself is unchanged — 5 videos, 2 minutes each, 1 GB — it's just genuinely per-site now, the way it reads.

Existing rows from before this change (yours, from testing) have no site attached and are simply excluded from every count and every list going forward. They don't show up anywhere and they don't count against anything. Nothing to clean up on your end.

## Proof, not just a description

`test/media-limits.js` now sets up two sites for the same account and uploads 5 videos to one before touching the other, then asserts the second site reports **zero** — the literal scenario you hit, reproduced and pinned down.

New file `test/media-site-scope.js` covers the lifecycle directly:
- Deleting a site deletes its media (file + row) and leaves a *different* site's media completely alone.
- Renaming a site carries its media to the new address and the old address has nothing left.
- The account-wide delete route wipes every site's media, not just one.

## What changed, file by file

- `server.js` — `site_media.site_sub` column (migrated via the existing `_ensureColumn` helper, same pattern as every other column added to this codebase); `_mediaUsage(email, sub)` now scoped by site; `POST /api/site-media` requires and validates a `subdomain`, checked against site ownership before anything is written; `GET /api/site-media` requires `?subdomain=`; new `_deleteSiteMedia(sub)` and `_deleteAllMediaForEmail(email)` wired into all three site-deletion routes; the rename path in `POST /api/personal-site` carries `site_sub` across to the new address.
- `public/app.html` — `cvRenderUploads`, `wcLoadMediaUsage`, `wcUploadMedia`, and `_tvUploadMedia` (shared by the text-video generator and the voice recorder) all now send the current site's subdomain, sourced from `wcSite.subdomain`, with a guard against uploading with no site open.
- `test/media-limits.js` — updated for the new per-site contract, plus a new direct check that a second site's uploads don't count against the first.
- `test/media-site-scope.js` — new: delete/rename/wipe lifecycle, proven end to end against real files on disk.
- `test/media-upload-disk.js`, `test/media-video-duration.js`, `test/browser/editor.js` — updated to pass a site subdomain, since the routes they exercise now require one.
- `CLAUDE.md` — the media-limits paragraph rewritten to describe "per site" instead of "per subscriber."

Let me know what you find on the next pass.
