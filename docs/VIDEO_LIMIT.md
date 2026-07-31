# The video limit

Both fixed. **905 source assertions** and **270 browser assertions** at 1440px and 390px, 0 failures.

---

## Bug 1 — it wasn't counting images. It was counting things you never uploaded, and you couldn't clear them.

I checked the count first, because that's what you suspected:

```js
if (r.kind === 'video') { videoBytes += r.bytes; videoCount++; }
else imageAudioBytes += r.bytes;
```

Images are stored as `kind: 'image'` and never counted as video. I proved it: two images then a video — `videoCount: 0`, upload accepted. So the arithmetic was right, which means the number you hit was real. **Five videos were genuinely on your account.** Three things conspired to make that both true and impossible to believe:

**1. The text video generator writes videos.** Every time you generated one, it uploaded a `.webm` to your media library as a video. You never chose to "upload a video" — the feature did it on your behalf, and each one spent a fifth of your quota.

**2. Nothing ever told you the number mattered.** The meter read `(4/5)`, which is a countdown to a wall with no sign explaining what's at the end of it.

**3. And there was no way to delete anything.** The message said *"Delete one first."* The Uploads panel could only ever **add** — every tile was a place-it-on-the-page button. `DELETE /api/site-media/:id` had existed the whole time and **nothing in the app ever called it.** So the one instruction you were given was for an action the product didn't have.

That's the actual defect: not a miscount, but a limit that was invisible, partly spent on your behalf, and unclearable.

### What changed

- **The Uploads panel now has a delete on every file** — 26px, always visible rather than shown on hover, because that panel is used on a phone too. It's pressed by the browser tests at both widths and the file is watched leaving both the screen and the server.
- **Each tile shows what it is and how big it is** (`VIDEO · 4.2MB`), so the library is legible rather than a grid of identical 🎬.
- **The count is hardened anyway.** A row whose `kind` column is somehow empty is now read from the file's own mime type, and anything unrecognisable falls to the image/audio side — a row that can't be identified can never inflate the number you're judged by.

The confirm dialog says plainly that anything already placed on a page will stop loading. Deleting doesn't rewrite your document behind your back; a broken image you can see is better than a page silently edited.

## Bug 2 — the cap is gone

**`videoMaxCount: 5` no longer exists.** You offered "raise it to 20 or remove it entirely and handle storage gracefully" — I removed it, because a count cap was never measuring the thing that costs anything.

Storage is the real constraint, so it's the only one enforced, and the **video pool goes from 300 MB to 1 GB** — comfortably 20–40 web-sized clips.

The message when you genuinely fill it now says what's stored and where to clear it:

> Video storage is full — 1024 MB of 1024 MB used across 25 videos. Remove one in Uploads to make room.

instead of

> ~~Video limit reached (max 5). Delete one first.~~

Verified by uploading **25 videos in a row** with no cap, filling the pool, being refused, deleting one file, and uploading again successfully.

The meter now reads `… 12/1024 MB video (3 clips)` — the clip count as information, not a score out of five.

---

## Two things I did not change, and you may want to

**The per-file cap is still 25 MB**, which is low for a showreel clip. I left it because you didn't raise it and because it isn't free to move: uploads are buffered **entirely in memory** (`multer.memoryStorage`), so a 100 MB per-file cap means 100 MB of RAM per concurrent upload and a plausible way to run the container out of memory. Doing it properly means streaming uploads to disk instead. **Say the word and I'll do that** — it's a contained change, but it is a change to how uploads work, not a number.

**1 GB per user is a real storage cost.** On Railway that's volume space you pay for, and it's per Pro subscriber. 300 MB → 1 GB triples the worst case. I judged that the right call for a product whose headline feature is a showreel site, but it is your bill — tell me if you want it dialled back to, say, 500 MB.

## What I changed

- `server.js` — `videoMaxCount` removed; `videoPool` 300 MB → 1 GB; the storage message names the amount and the place to clear it; `_mediaUsage` falls back to the file's mime when `kind` is missing and returns `imageAudioCount` too.
- `public/app.html` — `cvDeleteMedia()`; a delete button and a kind/size label on every tile in the Uploads panel; the meter shows a clip count rather than a countdown.
- `test/media-limits.js` — new: the reported scenario, 25 uploads with no cap, a genuinely full pool, the wording of the refusal, delete-then-reupload, and an unidentifiable row not being called a video.
- `test/browser/editor.js` — the delete button is present, thumb-sized and hittable, and pressing it removes the file from the screen and the server, at 1440px and 390px.

## Two of my own checks were wrong first

Worth recording: I filled the pool by setting **every** video row to half the pool, which leaves 24 half-pools behind so no single delete could ever make room — the check was failing on its own arithmetic, not on the code. And I compared a count against a number I'd written down earlier in the run, after a delete had already moved it. Both now measure the server rather than my bookkeeping.
