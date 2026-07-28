# Video playback — what was actually wrong

Fixed in both places. **791 source assertions** and **198 browser assertions** at 1440px and 390px, 0 failures, run twice.

I went through your checklist first, and three of the five came back clean. Here is what each one turned out to be.

---

## Your checklist, answered

**Is the video file reaching the server and saving correctly?** — **Yes.** Uploaded a 200KB file through the real endpoint: `200`, stored on disk at the right size, row written with `kind: video`, `mime: video/mp4`.

**Is the video URL correct in the saved config?** — **Yes.** `/media/N`, exactly what the upload returns.

**Any JavaScript errors blocking the player?** — **No.** Recorded a real clip in the browser, uploaded it through the app's own path, and `video.play()` resolved with `readyState: 4` in both the canvas and the preview. No page errors.

**Is `<video>` using the right src?** — The src was right. **The tag was missing things**, and the box around it was cutting it in half.

**Is it a codec issue?** — Not the one you'd expect, but MOV was being *rejected outright*. Fixed below.

---

## 1. The control bar was being clipped off — this is the live-site bug

This is a regression I introduced last round when I made media take the height of its box.

A video with a label renders as **label + video** inside the element. The label is ~19px of real content, and the video was also asking for `height: 100%` — so the pair came to more than the box, and the `overflow: hidden` I added cut the bottom off.

Measured in the browser:

```
wrapH: 300   vidH: 300   labelH: 19   vidBottomPastWrap: 27   overflow: hidden
```

**27 pixels clipped from the bottom — which is exactly where the native control bar lives.** You saw a play button (the big centre one) and the controls that would actually respond were not on screen to be pressed.

The fit wrapper is a column now: the label takes what it needs, the media takes the rest. There's a browser assertion that a *labelled* video's controls sit inside its box, because without a label the bug is invisible.

## 2. In the editor, the overlay was on top of everything

Confirmed directly — asking the browser what was on top at the video's centre returned `ed-box is-sel`, the selection overlay. That overlay is how dragging and resizing work, so every click in the canvas lands on it and never on the video.

Punching a hole in it for videos would cost dragging and resizing on exactly the elements that most need it. So a selected video now carries its own **▶** next to the gear, which plays and pauses the clip inside the canvas and turns into **❚❚** while it runs.

## 3. The browser was left to guess what the file was

`<source src="…">` with no `type`, and `/media/12` carries no extension — so there was nothing to go on. On formats a browser is unsure about, that's the difference between "cannot play this" and a silent frozen frame.

Now:

- New uploads store the exact mime on the element, so `<source type>` is precise rather than inferred.
- **Videos uploaded before today are looked up from their own record**, so your existing content gets a correct type too — one memoised query.
- `playsinline` added, so on iOS the video plays in the page instead of hijacking the screen into the native full-screen player.
- `/media/12.mp4` now works as well as `/media/12`, so a URL can describe itself.

## 4. MOV was refused outright

`video/quicktime` wasn't on the accepted list, so an iPhone recording came back **"Unsupported file type"** for reasons that had nothing to do with the user.

It's accepted now — and **not** re-encoded, because there's no transcoder here and pretending otherwise would be worse than saying so. The upload returns a flag, and you get told plainly:

> This file is a .mov. It will upload and it plays in Safari and most browsers, but MP4 is the format that plays everywhere — export as MP4 if you can.

## 5. A file that can't be decoded now says so

Previously a clip the browser couldn't play left a frozen frame with dead controls and no explanation. The canvas reports a media error back to the editor, which tells you — while you can still do something about it — rather than leaving it to be discovered by a visitor.

---

## Verified

| | 1440px | 390px |
|---|---|---|
| A real clip uploads and comes back typed | ✅ | ✅ |
| **A labelled video's controls are inside its box** | ✅ | ✅ |
| The source is typed and the player stays inline | ✅ | ✅ |
| A selected video carries a play control | ✅ | ✅ |
| **Pressing it actually plays the clip in the editor** | ✅ | ✅ |
| **Plays in preview, the way a visitor sees it** | ✅ | ✅ |
| With its controls inside the box there too | ✅ | ✅ |

The clip is recorded by the test browser itself with `MediaRecorder` and pushed through the app's real upload path — a fake byte blob would prove the plumbing and nothing about whether a video plays.

Two of my own assertions were wrong on the first run and are worth recording: I checked `!paused` 1.2 seconds after pressing play on a **1-second** clip, so a video that played to the end reported as one that never started — the playhead is the evidence, not the pause flag. And a photo assertion failed because the canvas is now tall enough that the element sat below the fold, where `loading="lazy"` means the browser never fetches it.

## One limitation I should state plainly

**My test browser is open-source Chromium, which ships without H.264.** So I proved playback with WebM/VP9, which it does have. Your MP4s exercise the same path — same `<video>`, same `<source type>`, same box layout, same server headers (`200`, `video/mp4`, `Accept-Ranges: bytes`, `206` on a range request) — but I could not decode an H.264 file here to watch it play. If an MP4 still refuses after this deploy, tell me and I'll treat it as a fresh investigation rather than assuming these fixes covered it.

## When you test

- **In the editor**: select the video, press the green **▶** beside the gear.
- **In preview and on the live site**: the video's own controls, which are now inside the box.
- If you upload a `.mov` it will work and you'll get a note suggesting MP4.
