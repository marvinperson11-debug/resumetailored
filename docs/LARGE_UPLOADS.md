# 100 MB uploads, streamed to disk

Built. **921 source assertions** and **270 browser assertions**, 0 failures — including a real 100 MB file through the real endpoint.

| | before | now |
|---|---|---|
| Per file — video | 25 MB | **100 MB** |
| Per file — image / audio | 8 MB / 25 MB | unchanged |
| Total pool per user | 1 GB | **1 GB** (unchanged, as you asked) |
| How the file arrives | buffered in RAM | **streamed to disk** |

---

## The memory claim, measured rather than asserted

Three **100 MB uploads at once**, with the uploader in a separate process so the numbers are the server's alone:

```
heapUsed      base   18.8 MB   peak    25.0 MB   growth  +6.2 MB
arrayBuffers  base    0.0 MB   peak    18.9 MB   growth +18.9 MB
rss           base   89.8 MB   peak   114.8 MB   growth +25.0 MB
```

**300 MB of payload, 25 MB of server memory.** What's left is socket read buffers — about 6 MB per connection — not the files.

Worth recording how nearly I got this wrong: my first attempt ran the uploader *inside* the server process and reported **+319 MB**, which looks exactly like the bug I was claiming to have fixed. That was the test client's own buffers. The measurement only means anything with the client outside.

## The part that disk storage makes harder, not easier

`multer.diskStorage` writes the file **before the route runs**. So by the time anything checks the file type, the per-kind size, the quota, or whether you're even signed in, 100 MB is already sitting on the volume. Every one of those rejections now has to delete it — and a rejected upload that leaves 100 MB behind is invisible: no row points at it, nothing lists it, and the disk just fills.

There's one exit (`bail`) and it always sweeps up. Six rejection paths are tested by uploading a real file, refusing it, and then checking the temp directory is **empty**:

| refused because | temp dir after |
|---|---|
| unsupported type | empty |
| image over its own 8 MB cap | empty |
| not signed in | empty |
| not a subscriber | empty |
| pool full | empty |
| past multer's own 100 MB ceiling (killed mid-stream) | empty |

Two details behind that:

- **The temp directory lives inside the media directory**, so finishing an upload is a `rename` — a directory entry, instant regardless of size. A temp dir elsewhere would be a different filesystem, where `rename` is `EXDEV` and every 100 MB upload becomes a 100 MB copy. There's a fallback for that case, but the layout means it shouldn't happen.
- **The 8 MB image cap is enforced in the route now.** multer's own limit has to be the largest of the three (100 MB), because it can't know which kind a part is before reading it — so a 90 MB "image" gets written before it can be refused, and the per-kind check is what keeps the small caps real.

## Upload progress — because 100 MB with no feedback looks broken

`fetch` cannot report upload progress. At 25 MB "Uploading…" was over before you read it; at 100 MB on a phone it's minutes of a screen that looks frozen, and the natural response to a frozen screen is to press the button again and start a second one.

The uploader is `XMLHttpRequest` now and the toast counts: **`Uploading… 47% (98 MB)`**. Where a proxy hides the total, it falls back to the plain message rather than inventing a percentage.

I added this without being asked because the feature you requested doesn't really work without it.

---

## One number you should look at

**At 100 MB per file, a 1 GB pool is 10 videos.**

Last round you wanted room for 10–20 clips. These two settings pull against each other: raising the per-file cap 4× while holding the pool means a user who actually uses 100 MB files gets *fewer* clips than the pool was sized for.

In practice most web-exported clips are 5–20 MB, so the realistic case is still 50+ clips and the 100 MB ceiling is headroom for the occasional big one. That's why I built it exactly as you specified. But if a user uploads ten 100 MB files they will hit "storage is full" at ten clips, and the message will be accurate and still surprising.

You said you'd monitor and adjust with real data, which is the right call — I just don't want the arithmetic to be a surprise when it shows up. **2 GB would make 20×100 MB genuinely possible** if you'd rather not wait for the first complaint.

## Two things I did not do

- **No transcoding.** A 100 MB clip is served as-is to every visitor, so someone's phone downloads 100 MB to watch a showreel. Compressing on upload is the real answer and it's a much bigger piece of work (ffmpeg in the image, a job queue, a progress model). Worth its own round if you want it.
- **No resumable uploads.** A 100 MB upload that drops at 90% starts over. Fine for now; worth knowing when someone on a train complains.

## What I changed

- `server.js` — `multer.diskStorage` with the temp dir inside the media dir; `perFile.video` 100 MB; multer's ceiling derived from the largest per-kind cap; `bail()` deletes the temp file on every rejection; `rename` with an `EXDEV` copy fallback.
- `public/app.html` — `wcUploadMedia` uses XHR with `upload.onprogress`; the toast shows percentage and file size.
- `test/media-upload-disk.js` — new: a real 100 MB upload, the bytes verified on disk, all six rejection paths leaving no temp file, and the client having progress at all.
- `test/site-publish.js` — the "no upload uses `authHeaders()`" check now tests the intent rather than counting `fetch` calls, since the main uploader is no longer one.
