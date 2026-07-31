# Two bugs: the canvas that moved, and the media that didn't show

**800 source assertions** and **225 browser assertions** at 1440px and 390px, 0 failures.

I measured both before changing anything. One of them was exactly what you described and is fixed. The other did not reproduce, and I want to be straight with you about that rather than ship a guess and call it fixed.

---

## Bug 2 — the canvas moving left to right. Fixed.

This one was real, it was on both, and here is what it measured:

```
                          BEFORE                    AFTER
1440px laptop   stage 1173px wide / shows 1126   1126 / 1126
                → 47px of sideways scroll        → 0

390px  phone    stage  777px wide / shows  334    334 /  334
                → 443px of sideways scroll       → 0
```

Not inferred from the numbers — I asked the browser to scroll the stage as far right as it would go and read back where it landed. 47 pixels on the laptop, **443 pixels on the phone**. That is the canvas sliding out from under you.

### Why

`transform: scale()` changes what gets **painted** and nothing at all about the **layout box**. The canvas is a 1200px-wide page scaled down to fit — at 390px that scale is 0.245, so it *draws* 294px wide. But its box stayed **1200px**, and the stage dutifully scrolled sideways to let you reach the 900-odd pixels that were never going to be there.

The giveaway was in the fitting code itself. It already compensated for the transform in one direction:

```js
wrap.style.height = (docHeight * k) + 'px';   // height: corrected for the scale
if (wrap) wrap.style.width = canvasW + 'px';  // width: not corrected at all
```

The height had been fixed at some point and the width never had. So the canvas was correctly sized top-to-bottom and 1200px wide forever.

### The fix

The wrap keeps the canvas's own coordinates — 1200px across, the document's real height — because the selection overlay, the drag maths and the resize handles are all positioned in exactly those numbers. It is now taken **out of flow**, and its parent is given the **scaled** size. Layout box and painted box are the same rectangle, so there is nothing left to scroll, and the stage centres it because there is finally something the right size to centre.

Checked in the browser, at both widths, and re-checked after each thing that re-fits the stage — the phone toggle and a zoom change — because each one is its own chance to put it back:

| | 1440px | 390px |
|---|---|---|
| The canvas cannot be dragged sideways | ✅ | ✅ |
| It sits centred, equal gap either side | ✅ | ✅ |
| The page itself doesn't scroll sideways | ✅ | ✅ |
| Still true after switching to the phone view | ✅ | ✅ |
| Still true after zooming out | ✅ | ✅ |

Vertical scrolling is untouched, as you asked.

One thing I did not do: **at zoom above 100% the canvas can still be panned**, because at that point you have deliberately made it bigger than the window and panning is the only way to reach the rest of it. At 100% and below — which is everything you'd hit without dragging the zoom slider — it is locked.

---

## Bug 1 — photos and videos on mobile. I could not reproduce it.

I built a site with a photo and a video in it and measured what actually rendered, on four surfaces:

| | image | video |
|---|---|---|
| Canvas, desktop view | 310px in a 310px box, decoded | 173px in the 200px box below its label |
| Canvas, **phone view** | 310px ✅ | 173px ✅ |
| **Preview**, phone view | 310px ✅ | 173px ✅ |
| **Published page**, 390×844 iPhone profile | 310px ✅ | 173px ✅, controls and all |

And the whole chain end to end — pick a photo slot, upload through the app's own file picker, save, publish, then fetch the public page **as an anonymous visitor**:

```
doc after upload   {"src":"/media/1","srcType":"image/png", …}
config in the DB   contains /media/N   ✅
GET /site/m-site   200  →  <img class="sd-img" src="/media/1">   ✅
```

Nothing is dropped anywhere along that path. I have a screenshot of the published page at phone width with both the photo and the video's control bar on it.

So I don't have the failure in front of me, and I'm not going to tell you I fixed something I never saw.

### What I did change, and why it is not a guess

There was one genuine asymmetry in the stylesheet, and it is the only rule in the whole sheet that made a phone treat a photo differently from a laptop:

```css
@media (max-width: 820px) {
  .sd-ibox, .sd-img { height: auto !important; }   /* ← phone only */
}
```

`height: auto` on a photo means **take your height from the file**. On desktop the height comes from **the box you drew**. So the two have not been rendering the same thing, and the phone was the one being told to improvise. The rule dates from before media elements carried a height of their own — back then `height:100%` of an auto-height parent was zero and a photo vanished, so forcing `auto` was the fix. That reason is gone; the rule wasn't.

I removed it, and made the containing box a **grid** with two rows (label, then media) instead of a flex column. Same numbers on this browser — I measured before and after and the geometry is identical — but it gets there differently, and the difference matters:

- A `1fr` track is resolved from the element's **own** height, before the media is measured at all.
- A flex column asks a **replaced element** (an `<img>`, a `<video>`, an `<iframe>`) to grow from its intrinsic size. That is the corner of flexbox where engines have historically disagreed, and a video whose metadata hasn't arrived has **no intrinsic height to grow from**. Safari does not preload video metadata as eagerly as Chrome does.

So: the box you draw is now what the media gets, on every engine, at every width, without anything having to negotiate. That's a hardening, not a confirmed fix, and I'd rather say so.

### Please test — and if it's still wrong

I test in Chromium; your phone is almost certainly Safari, and this is exactly the class of difference that lives in that gap. If the photos are still missing after this deploy, three things would let me find it in one round instead of five:

1. **Your site's address** — I can fetch the real published page and look at the real HTML rather than one I made up.
2. **Does the published site show them on your laptop?** (Not the editor — the live `/site/...` page.) If yes it's a rendering difference; if no it's the file or the save, and those are completely different investigations.
3. **A screenshot of the phone** — an empty box and a blank space look the same in a sentence and mean opposite things.

One possibility I could not check from here: uploaded files live in `DATA_DIR` on Railway. If that isn't a mounted volume, a deploy wipes them — and your laptop would keep showing the photos anyway, because they're cached for a year, while a phone that never saw them gets nothing. That would look precisely like "desktop fine, mobile blank." Worth confirming the volume is mounted.

---

## What I changed

- `public/app.html` — `edFitStage` sizes the canvas box to the **scaled** dimensions; the wrap is out of flow with a top-left origin; `.cv-stage` uses `safe center` so an over-zoomed canvas overflows where it can be scrolled to rather than off both edges at once.
- `server.js` — `.sd-el--fit` is a two-row grid; the phone-only `height:auto!important` on photos is gone.
- `test/browser/editor.js` — the sideways-scroll checks above, plus a check that an uploaded photo on the **published page at 390px** takes the height of its box and not of the file.
- `test/site-features.js` — the source assertions follow the new rules, including one asserting the phone override is **absent**.
