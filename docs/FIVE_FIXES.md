# Five fixes — and the reason uploads were vanishing

All five built and verified. **758 source assertions** and **156 browser assertions** at 1440px and 390px, 0 failures, run twice.

---

## 1. Uploads were failing with a 400. Every single one.

This wasn't a display problem. **No photo, video or voice clip has ever uploaded successfully from the Website Creator.**

`authHeaders()` declares `Content-Type: application/json`. That is correct for every JSON call in the app, and catastrophic for a file upload:

```js
fetch('/api/site-media', { method: 'POST', headers: authHeaders(), body: fd })
```

Setting `Content-Type` on a `FormData` body **overwrites the `multipart/form-data; boundary=…` the browser would have set**. So the boundary is lost, and `express.json()` — which parses anything claiming to be JSON — tries to read the multipart body, chokes on the first `------WebKitFormBoundary`, and returns 400 *before the upload route is ever reached*.

The server log for every upload you ever tried:

```
SyntaxError: Unexpected token '-', "------WebK"... is not valid JSON
NET 400 POST /api/site-media
```

Fixed with `authHeadersNoType()` — authorisation without a content type — on both upload paths. Now:

```
NET 200 POST /api/site-media
NET 200 GET  /media/1
```

Two things came with it:

- **A toast**: "📷 Photo uploaded" / "🎬 Video uploaded" / "🎙 Audio uploaded".
- **The upload lands on the element you started it from.** It used to write to whatever was selected when the upload *finished* — so picking a file and then clicking something else while it uploaded would have put your photo on the wrong box.

The photo now appears in the canvas the moment the upload completes. The browser test proves it end to end: a real file through the real picker, a real `/media/N` URL in the document, and an `<img>` in the canvas with `naturalWidth > 0` — decoded, not just present.

## 2. The preview device toggle

It only ever resized the **canvas**. In preview the highlight moved and the page didn't — dead by every measure except the one being taken.

It now drives whichever view is on the stage.

Fixing it turned up a second thing: the preview frame was `width: 100%` of a parent with no width of its own, so it fell back to the iframe default of **300px** — *narrower* than the phone preview it was supposed to be wider than. A percentage is only a width if something above it has one. It is measured from the stage now.

On a phone the two coincide, because a 390px phone preview inside a 334px stage is clamped to the stage. That is correct, not a dead toggle.

## 3. ← Back to editing

In the top bar, visible only while previewing. The Preview button hides while you're in preview, so the pair never both show.

## 4. "Done Editing" → "Save"

Not just a relabel. **Save now saves and stays.** The old button made saving and leaving the same act, so there was no way to write your work down without closing the thing you were writing.

It forces a real write every time rather than "flush if dirty" — being told "Saved" because nothing had changed is fine right up until the moment something *had* changed and the autosave had failed quietly. If the write fails it says so instead of claiming success.

Leaving is Back to editing, Publish, or the app's own navigation.

## 5. "Home" removed from the header

Removed, not hidden — the write that produced it is gone too. Which page you're on is already in the bottom bar's page count and in the Pages panel.

---

## What was verified, and how

The upload fix is the one that mattered, and it's the one a source-level test could never have caught: the code *looked* right at every layer. It took sending an actual file through an actual file picker and reading the server's response.

| | 1440px | 390px |
|---|---|---|
| Choosing a photo opens a file picker | ✅ | ✅ |
| The upload reaches the server and returns a `/media/N` URL | ✅ | ✅ |
| The photo is **in the canvas, decoded** | ✅ | ✅ |
| With a toast saying so | ✅ | ✅ |
| The device toggle drives the preview's width | ✅ | ✅ |
| Preview offers a visible way back to editing | ✅ | ✅ |
| Back to editing returns to the canvas | ✅ | ✅ |
| The page name is gone from the header | ✅ | ✅ |
| The button says Save, writes to the server, **and leaves you in the editor** | ✅ | ✅ |

## One thing worth knowing

Anything you uploaded before this deploy never made it to the server. There is nothing to recover — the files never arrived. Re-upload them and they will stick.
