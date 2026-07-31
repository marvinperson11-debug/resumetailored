# The phone keeps the layout

Built. **824 source assertions** and **261 browser assertions** at 1440px and 390px, 0 failures.

There is one thing in here you should read before you test — it is at the bottom, under **The trade-off**.

---

## First, what your screenshots actually showed

All five are the **same modal on your phone**. Two of them (IMG_5152, IMG_5153) have **Desktop** selected in the toggle; three (IMG_5154–5156) have **Mobile** selected.

So the layout you like is the **desktop** layout scaled down, and the one you don't is the Mobile pill — which was rendering the page at 390px and hitting exactly the same rules the published site did. They looked identical because they *were* identical.

That is useful, because it means the target is unambiguous: make the published page do what the Desktop pill does.

## What was wrong

One rule, in the published stylesheet's phone block:

```css
@media (max-width: 820px) {
  .sd-el { position: static !important; width: 100% !important; margin: 0 0 18px; }
}
```

Every element, whatever it was and wherever you put it, became a full-width block in a single column. A three-up gallery became three slabs. Text beside audio became text, then audio. A form beside its links became a form, then its links. It stopped being the site you built.

It also forced `.sd-inner { height: auto }`, shrank every heading to 32px, and rewrote the gallery's column count — all of it compensating for a stack that shouldn't have existed.

## What it does now

**A phone is a smaller window, not a different document.**

Your elements are stored as **percentages across** (left, width) and **pixels down** (top, height, type size). So the horizontal design already survives any width by itself — 6% from the left is 6% from the left at 1440px or 390px. What doesn't survive is the vertical axis and the type, which stay at their designed pixel sizes while the boxes around them get narrower. That mismatch is what the old rule was papering over by giving up.

So the page is now **laid out at a design width and scaled down whole**. One factor moves all three axes together, which is the only way the design stays the design.

Measured on the published page, same document:

| | desktop 1440 | **iPhone 390** | small 360 |
|---|---|---|---|
| Elements on the page | 16 | **16** | 16 |
| Rows holding more than one element | 3 | **4** | 4 |
| Horizontal scroll | no | **no** | no |

Every one of your four points:

1. **Gallery stays 3-up on the phone.** Not one slab at a time.
2. **About keeps text beside the voice intro.**
3. **Bookings keeps the form beside the social icons.**
4. **The hero is a hero, the stats row is a row.** Nothing is restacked, because nothing is re-laid-out at all — it's the same layout, smaller.

The design width is **1000px**, which is deliberately the same number the editor's phone-frame preview lays out at. So what you publish is what you previewed, by construction rather than by coincidence.

Two mechanical details worth recording, because both are the kind of thing that silently half-works:

- **An outer box carries the scaled height.** A transform paints smaller and leaves the layout box alone, so without it the document would be 2.5× too long and scroll into empty space below the footer.
- **The factor is set in JavaScript**, because `scale()` takes a unitless number and `calc(100vw / 1000)` is a length — CSS genuinely cannot do this one. It's recomputed on resize, on orientation change, after webfonts land (a page measured at fallback metrics comes out short), and whenever late-arriving media changes the page's length.

`Hide on mobile` still hides on mobile — that's an explicit choice you made, and it's the one mobile override that survives.

---

## The trade-off, plainly

Showing a 1000px-wide design on a 390px screen means everything is at **0.39×**. Measured on the rendered page:

| | desktop | phone |
|---|---|---|
| Body text | 16px | **6.2px** |
| Your name (h1) | 54px | **21px** |

**Body text at 6px is small.** Headings, names, buttons and captions read fine — it's paragraphs that get tight.

This is not a bug I can tune away. Your boxes are fixed proportions of the page width; if the type stays at 16px while a box narrows from 260px to 100px, the text simply spills out of the box and the design breaks in a different way. Any layout-preserving answer arrives at the same place. It is the same trade-off every desktop site makes when you open it on a phone — and, importantly, **the page is pinch-zoomable** (there's no `user-scalable=no`), so the overview is the design and a pinch is the reading.

I'm flagging it because you'll see it in the first two seconds and I'd rather you hear it from me. It is what you asked for, it matches the previews you approved, and it is now measured and asserted.

**One knob, if you want it.** `SD_MOBILE_W` in `server.js` is the design width. Lower it and everything gets bigger:

| `SD_MOBILE_W` | scale at 390px | body text |
|---|---|---|
| 1200 | 0.33× | 5.2px |
| **1000 (now)** | **0.39×** | **6.2px** |
| 800 | 0.49× | 7.8px |
| 700 | 0.56× | 8.9px |

The catch below ~1000: your boxes are proportional but their **heights are not**, so a narrower design width makes every box relatively taller than you drew it. At 700 the page is noticeably more vertical than the desktop version. That's why I left it at 1000 — it matches the preview exactly. **Say the word and I'll change it**, or make it a per-site setting.

## What I changed

- `server.js` — the phone block no longer restacks; `.sd-vp` / `.sd-page` wrappers; `SD_MOBILE_W`; the inline fit script.
- `test/site-features.js` — the old stacking rules must be absent, the scaling wrapper present, the fit recomputed on resize/rotate/content change, `mhide` still working, and the page still pinch-zoomable.
- `test/preview-parity.js` — the assertion that used to require `position:static!important` now requires the scaler and forbids the stacker.
- `test/browser/editor.js` — counts **rows holding more than one element** on the published page at 390px vs 1200px, since "everything is in one column" is a claim about rows, not about any single element.
- `test/golden/site-doc.html` — regenerated.

## Three of my own checks were wrong first

Recording them because they were mine, not the product's: two measured the page in **screen** pixels after it had become a **scaled** page, so a photo correctly drawn at 200 design px read as 78 and looked like a regression; and the band probe fired twice, the second time after removing the iframe it was reading — a null dereference that failed the page-error check for reasons entirely inside the harness. All three now divide the scale back out, or fire once.
