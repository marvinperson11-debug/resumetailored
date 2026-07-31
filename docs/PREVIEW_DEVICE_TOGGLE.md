# The device toggle in Preview

Fixed. **804 source assertions** and **229 browser assertions** at 1440px and 390px, 0 failures.

You were right, and you were right about *where*: it worked in the editor and was dead in Preview. Here is what it measured, pressing the real buttons rather than calling the function behind them.

---

## What it did before, on a phone

```
390px window, stage 334px wide

                       frame width    page laid out at
entering preview           334              334
after tapping 📱           334              334      ← identical
after tapping 🖥           334              334      ← identical
```

The highlight moved. The corner radius changed. **The document inside was the same 334px page both times.** Nothing to see, because there was nothing different to show.

On a 1440px laptop the same code gave 1126 ↔ 390 and worked fine — which is why it only ever looked broken on the phone.

## Why

One line:

```js
const avail = Math.max(280, stage.clientWidth);          // 334 on a phone
f.style.width = (mobile ? Math.min(390, avail) : avail) + 'px';
//                        min(390, 334) = 334  :  334
```

Both branches produce **the same number** whenever the stage is narrower than 390px. And the deeper problem underneath the arithmetic: the "desktop" preview was being rendered at **334px**, so your site's own `@media (max-width: 820px)` rules were in force in *both* views. The desktop preview was already a mobile preview. There was no second thing for the button to switch to.

## The fix

**A preview is of a layout, not of the space available to show it.**

The page is now laid out at the device's real width and **scaled** to fit whatever room there is:

- **📱 Mobile** — laid out at **390px**, scaled to fit.
- **🖥 Desktop** — laid out at the stage width, or **1000px minimum**, scaled to fit. Never narrow enough for your site's phone stylesheet to take over.

Where there is room for the real thing — a desktop window — the scale is 1 and nothing changes from before.

```
390px window, stage 334px wide

                    page laid out at    drawn at    scale
after tapping 🖥          1000             334      0.334
after tapping 📱           390             334      0.856
```

Two genuinely different documents. On your phone, Desktop now shows the whole desktop page shrunk down — three columns, the wide hero, the side-by-side stats — and Mobile shows the stacked phone layout at readable size.

At 1440px: 1126 and 390, scale 1 both. Unchanged.

Two smaller things that came with it:

- The frame is scaled, so the **box around it** carries the scaled size — the same lesson as the canvas last round. Without that a preview narrower than the page it is showing scrolls sideways instead of shrinking.
- The phone outline (shadow and rounded corners) moved onto that box, because a shadow drawn inside the page and then shrunk to a third is almost invisible.
- The frame's height is clamped to the page's **own** height once it has one, so a short site previewed at a third scale doesn't trail a screen and a half of white below itself.

## The check that should have caught this, and didn't

There was already an assertion called *"the device toggle drives the preview's width"*, and it passed at 390px the whole time. This is why:

```js
const roomForPhone = pvDesk.w > 400;
check('the device toggle drives the preview's width',
  pvMob.w <= 390 && pvMob.w <= pvDesk.w && (!roomForPhone || pvMob.w < pvDesk.w));
```

I wrote that carve-out, and it excused exactly the case that was broken — *"on a phone the two coincide; that is correct, not a dead toggle."* It was not correct. It reasoned about what the code was doing instead of about what you would see.

It's gone. The check now:

- **clicks the buttons** rather than calling `edSetDevice`, because "tapping does nothing" is a claim about a button, and a function that works when called directly says nothing about it;
- measures **the layout width of the page inside the frame**, not the frame — that distinction *is* the bug;
- asserts the desktop preview is wider than 820px, so it cannot silently become a phone preview again;
- and it holds at **390px with no exemption**.

## What I changed

- `public/app.html` — `wcFitPreview` picks a layout width from the device and a scale from the room; `#wcPreviewBox` added to carry the scaled size; show/hide moved onto that box; the height clamps to the real page once it loads.
- `test/browser/editor.js` — the toggle is now pressed, and measured on the page's layout width, with the phone carve-out removed.
- `test/site-publish.js` — source assertions pin the new sizing and assert the old identical-both-ways line is gone.

## No questions this time

Nothing was ambiguous here — the behaviour you described reproduced on the first measurement.

One thing worth knowing when you test: on a phone the **Desktop** preview is now a whole desktop page at about a third scale, so the text will be small. That is deliberate — it is showing you the desktop *layout*, which is the only thing that view can usefully mean on a 390px screen. If you'd rather it were pannable at 1:1 instead of shrunk to fit, say so and I'll change it.
