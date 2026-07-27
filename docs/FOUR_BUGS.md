# Four bugs — one of them was a modelling mistake, not a rendering one

All four fixed. **784 source assertions** and **184 browser assertions** at 1440px and 390px, 0 failures, run twice.

---

## 1. The three coloured boxes really were one element

You weren't fighting the selection code. In the document, "Neon Nights / Supercut / Afterglow" is **one `gallery` element holding three pictures**:

```js
el('gal', 'gallery', 80, 118, 1040, 380, {
  layout: 'slider', gap: 20,
  items: [ {…Neon Nights}, {…Supercut}, {…Afterglow} ],
})
```

A gallery is right for a photo grid and wrong for three showcase boxes: you can't select one, can't put a video in the middle one, can't give the first its own background. **You saw three boxes and the editor disagreed with you.** Every template does this.

Two changes:

**Templates now ship pre-split.** The template *data* keeps the gallery — a row of cells is a much more readable way to write one — but it's split into independent elements on the way to becoming your site. The `studio` template goes from a gallery to three `imagebox` elements at `80,112`, `431,112`, `782,112`, each 337×360, each with its own caption and its own colour. Click one, style one, put a video in one.

**Existing sites get a button.** The gear on any multi-picture element now offers **⛶ Split into separate boxes**, so a site built before today can be fixed in one press. Selecting lands on the first new box.

The split arithmetic has to agree with what `sd-gal--grid` actually drew — `repeat(cols, 1fr)` separated by `gap` — so the boxes land exactly where the cells were and the page doesn't jump.

**The one that would have bitten.** An empty photo slot is invisible by design (that was tried the other way and reverted). Split boxes carry a *deliberate* gradient, so without marking them as such, a template's three coloured cards would have vanished the moment they became editable — the split would have "worked" and deleted your page. They're marked `phShow`, and there's a test for both halves: a split box stays visible to a visitor, an ordinary empty slot stays invisible.

## 2. The video was allowed to be any height it liked

`.sd-video { width: 100% }` and nothing else. Height came from the aspect ratio — a portrait clip in a 300×200 box renders **533px tall** and hangs out of its own element, with no way to pull it back.

The element wrapper was also using `min-height`, which is an invitation to grow.

Now: **media takes the height of the box you drew** (`height`, not `min-height`), `object-fit: cover` fills that height without distorting the picture, and `overflow: hidden` means nothing can spill past the edge. Resize the box and the video resizes with it.

**Text still grows.** Clipping somebody's summary because the box was drawn a little short would be worse than the box getting taller, so `image / imagebox / video / map / box` are contained and text is not.

## 3. Eight resize handles, not one

There was exactly one, on the south-east corner. So an element could only ever be made bigger down-and-right from where it already was — to widen something on its left you had to resize it and then drag it back.

All eight now: four corners, four edges, each with the right cursor, each counter-scaled so it's a real target at phone zoom rather than four physical pixels.

A west or north drag **moves the origin as well as the size** — that's the whole difference between "grow right" and "grow left", and without it the extra handles would be the south-east one wearing different cursors. Dragging an edge past its opposite stops at the minimum instead of turning the box inside out.

## 4. A background on any element

It was only on the `box` type. Now every element — heading, paragraph, photo, video, form, map, social row, button — takes:

- a **colour**
- a **gradient** (seven presets)
- an **image** (upload)
- its own **corner radius** and **padding**, because a background with square corners jammed against its text isn't a background anyone wants
- a **↺** that clears all of it

The gradient is a preset list rather than a free-text CSS field, and the renderer only accepts a `linear-gradient(…)` of a shape it recognises. This lands in a `style` attribute on a public page, so `linear-gradient(red);}body{background:url(javascript:1)` is ignored rather than emitted, and radius and padding are clamped rather than trusted.

---

## Verified

The golden-render diff for this change is exactly one line — the video wrapper gaining a real height and its fit class — with every other byte identical:

```
- <div class="sd-el" style="…;min-height:260px;"
+ <div class="sd-el sd-el--fit" style="…;height:260px;"
```

| | 1440px | 390px |
|---|---|---|
| Every corner and side has a handle, big enough to grab | ✅ | ✅ |
| East drag: wider, left edge held | ✅ | ✅ |
| **West drag: wider, left edge moves** | ✅ | ✅ |
| South / north drags: taller, downward / upward | ✅ | ✅ |
| The video is contained by its box, not hanging out | ✅ | ✅ |
| It fills the box rather than being letterboxed | ✅ | ✅ |
| A background set in the panel reaches the rendered box, with its radius | ✅ | ✅ |
| A multi-picture element offers to split | ✅ | ✅ |
| Splitting turns one box into three, still on the page | ✅ | ✅ |
| **Each split box selects on its own** | ✅ | ✅ |

Plus, source-side: every template ships with no multi-item element left in it, the split geometry matches the grid the gallery drew, nothing written in a gallery is lost, and an element with nothing to split is refused rather than mangled.

## One thing I did carefully

`app.html` now calls two new functions from `site-doc-store.js`. That's the cache-coupling boundary that cost three rounds of testing before — fresh HTML against a day-old module, and the editor throws on load. The `?v=` on all three shared modules is bumped to `v3`.

## When you test

- **Pick a template fresh** to see the pre-split boxes. An existing site keeps its gallery until you press **⛶ Split into separate boxes** in the gear.
- Backgrounds and the split are both in the **⚙**, under Background and below it.
- Handles are on all four corners and all four edges of anything selected.
