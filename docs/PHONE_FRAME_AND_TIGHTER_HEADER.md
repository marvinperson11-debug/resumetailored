# A phone that looks like a phone, and a header that gets out of the way

Both built. **816 source assertions** and **255 browser assertions** at 1440px and 390px, 0 failures.

---

## 1. The template Preview header on a phone

Measured at 390px before touching it:

```
              BEFORE          AFTER
header         195px    →      93px
preview        353px    →     700px
```

**The preview is now double what it was**, and the header is under half.

### Three changes, and one of them was the real culprit

**The blurb is gone on phones.** "Professional CV — Dark hero, credential strip and a full experience section…" is two wrapped lines of text describing a template you are currently looking at, and you read it on the card you tapped to get here.

**Two rows instead of three.** Title and Close on the first, the device toggle and *Use this template →* on the second, with everything a size down — title 16 → 13.5px and ellipsised rather than wrapping, buttons 13 → 12.5px, padding 14/18 → 8/10. Done with CSS `order` and a zero-height break element, so **the markup is not reordered and the desktop header is untouched**.

**And the thing that was actually costing the most.** The modal panel was `max-height: 94vh` — a *maximum*, not a height. `flex: 1` on the preview stage only grows against a parent that has a height of its own, so the panel was sized by its contents and the stage settled at **353px whatever the screen**. That is why the header felt like it was eating everything: it was 195px of a 548px panel on an 844px screen, with nearly 300px of the window simply unused. The panel now has a definite height.

That last one helps the desktop too — the preview stage there goes from 352px to 751px. I've called that out because you asked for a mobile change and this one reaches both; it's the same root cause and leaving desktop deliberately worse would have been strange.

Desktop's header itself is untouched: every rule is inside a `max-width: 820px` query, and there's a check at 1440px asserting the blurb is still there.

## 2. The phone frame

A mobile preview is the right width but reads as a narrow column of the page rather than as a phone. There's now a chassis around it — dark bezel, rounded corners, an earpiece slot and a home indicator.

| | Desktop preview | Mobile preview |
|---|---|---|
| **On a desktop** | no frame, full page | **phone frame** |
| **On a phone** | no frame | no frame |

Exactly as you specified, and in **both** places: the editor's Preview and the template card's Preview modal. One rule, one set of constants, used by both fit functions:

```js
const _pvChassisOn = (mobile) => !!mobile && window.innerWidth > PV_CHASSIS_MIN;   // 820
```

Gated on the **screen**, not just the selection — on an actual phone the chassis is the one in your hand, and drawing a second one would spend the scarcest pixels there on decoration.

Two details worth recording:

- **The bezel is outside the scaled frame.** The page inside is scaled to fit; if the chassis were inside it, the bezel would shrink with the page and a preview at a third scale would have a three-pixel border.
- **The bezel is subtracted before the scale is worked out.** Otherwise the frame is what makes the preview overflow its own container — the thing meant to contain it becoming the reason it doesn't fit. There's a check that the framed phone still sits inside the stage.

Measured at 1440px: chassis on in mobile view (10px side bezel, 44px corners, 410px total for a 390px page), off in desktop view. At 390px: off in both, and the toggle still switches the layout underneath (1000 ↔ 390).

## What I changed

- `public/app.html` —
  - `.pv-chassis` styles, shared by both previews.
  - `wcFitPreview` and `wcTplDevice` both toggle it and take the bezel off `avail` before scaling.
  - `#wcPreviewChassis` / `#wcTplChassis` wrappers; the preview's show/hide moved onto the outer one.
  - The phone header block, all inside `@media (max-width: 820px)`.
  - The template modal panel given a definite height.
- `test/browser/editor.js` — chassis on/off for both previews at both widths, bezel thickness and corner radius, the framed phone fitting its container; header height measured against the preview it sits above, and the blurb's absence on a phone / presence on desktop.
- `test/site-publish.js` — source assertions that the chassis rule is shared, its constants match the stylesheet, the bezel is subtracted before scaling, the header rules are inside the phone query, the two rows come from `order` rather than moved markup, and the panel has a definite height.

## Two of my own checks were wrong first time

Worth recording, since they were mine and not the code's: one demanded the chassis helper be called three times when there are exactly two call sites, and one pinned `const avail = Math.max(280, stage.clientWidth);` with the semicolon — which the bezel subtraction now follows. Both were assertions about how the code is spelled rather than what it does; I tightened them to the behaviour instead.

## No questions

Nothing ambiguous in either item. When you test on your phone, the template Preview header should be two compact rows and the template itself should fill the rest; on your laptop, switching to Mobile in either preview should put it inside a phone.
