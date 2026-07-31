# Both fixed: template overlap, and the Mac toolbar

Measured, not guessed, on both — here's what was actually happening and what changed. **270 + 2 + 48 browser assertions, 938+ source assertions, 0 failures.**

---

## 1. Element overlap in templates

You were right that it wasn't one template — it was **8 of the 12**. I reproduced it by building each starter template from a real résumé (the same `templateDoc` → `fillFromResume` path `/api/personal-site/autogen` uses) and measuring the actual rendered geometry in Chromium, rather than reading pixel values off the page and guessing whether they'd collide.

### Root cause #1 — a mis-tagged decorative element (the "duplicated text" you saw)

Templates ship with sample copy, and the hero's `name` / `subtitle` / `summary` get overwritten with your real résumé data by `tagFields()` in `site-fields.js`. It works by finding the *first* element of each type (`heading`, `subheading`, `paragraph`) in the template.

Two templates — **Developer** and **Freelance** — have a small decorative element *before* the real intro paragraph, sharing the same `paragraph` type:

- Developer: a `$ whoami` kicker line, above the real "I make services that stay up…" paragraph
- Freelance: an `● Available from October` availability badge, above the real "I build and ship…" paragraph

`tagFields` grabbed whichever came first — the badge, not the real paragraph — and stuffed your **entire résumé summary** (up to 400 characters) into a 300×30px pill. That overflowing badge is what you saw as duplicated/overlapping text, with the "Start a project" button landing on top of the mess. Fix: `tagFields` now honors an explicit `field` on the template (a two-pass tag: explicit declarations first, then first-of-type for what's left), and I marked the *real* paragraph in both templates. The badge and kicker now keep their own static text, forever, exactly as designed.

### Root cause #2 — no length limit, and no room for the length that existed anyway

Two things compounded:

- The résumé **summary** had no real ceiling (used the full 400 chars).
- The **job title** used for the subtitle line had **no cap at all** — "Senior Regional Director of Manufacturing Operations and Continuous Improvement Strategy" is a real title, and it would render exactly that long.

Every template hero is hand-positioned (a heading at a fixed y, a paragraph below it, a button below that). Text boxes correctly *grow* to fit real content (`min-height`, not clipped) — but nothing below them moves when they grow. A paragraph that needed 260px instead of 80px just rendered on top of the button 20px below it. That's the "See the work" and "Start a project" overlaps in your screenshots, and it was happening in Executive, Graduate, Studio, Bold, Consultant, Coach, Developer and Freelance.

Fixed both ends:

- `deriveFields()` now caps `role` at 60 chars and `summary` at 220, cut at a **word boundary** (never mid-word) with a trailing "…".
- I measured the actual worst-case overflow in Chromium (real text, real fonts, both desktop and the 1000px-wide mobile canvas) and widened the gap between the paragraph and whatever sits below it in all 8 affected templates — button positions and section heights moved down by 80–100px, sized from real measurement plus a safety margin, not a guess.

I stress-tested with an intentionally extreme résumé — a very long job title *and* a maxed-out summary, together — and it's clean everywhere, on both desktop and mobile canvases.

### What I didn't touch

Bold's decorative purple block sitting partly behind its heading text is real design (the text is `z-index: 2`, the block is `z-index: 1` — text renders on top on purpose). My overlap detector flagged it at first and I confirmed it's intentional before leaving it alone.

### New regression test

`test/browser/template-overlap.js` — renders all 12 templates from a real, stress-test résumé at desktop and mobile widths and asserts zero text/button/image collisions in the hero. It's Chromium-based (like `test/browser/editor.js`), so it's not in the dependency-free loop — run it by hand:
```
node test/browser/template-overlap.js
```

---

## 2. Sidebar/toolbar cut off on Mac

I couldn't reproduce this directly — I don't have a Safari or macOS renderer available here, and Chromium-on-Linux showed the toolbar comfortably fitting all the way down to 1024px wide. But the code told me why it could still happen to you specifically.

The editor's top bar (Pages / Undo / Redo / Save on the left, Preview / Publish on the right) is one flex row. The **only** thing designed to shrink is an empty spacer in the middle (`.cv-title` — it used to hold the page name, now it's blank). Nothing else had `flex-shrink: 0`, and the row never wrapped except below 820px (a rule that was written for phones specifically).

That means the layout had **zero margin, by design** — Publish always sits flush against the padding edge with no slack, regardless of window width. That's fine as long as every browser measures the button text identically. They don't: Safari renders macOS's system font (San Francisco) at different metrics than Chromium/Blink does, and that's exactly the kind of difference that's invisible to any test I can run here but very real on your machine. If it renders even a few pixels wider, one of two things happens, and both match what you described:

- The whole cluster gets pushed past the right edge, with nothing to scroll it back into view — "Publish is obscured."
- Or, without a `flex-shrink: 0`, the *buttons themselves* shrink below their own text's width and the label wraps/crushes inside — "half the sidebar is cut off" is exactly what a squeezed button looks like.

Fixed both failure modes:
- Every real toolbar element (`Save`, `Undo`, `Redo`, `Pages`, `Preview`, `Publish`, the device toggle) now has `flex-shrink: 0` and `white-space: nowrap` — nothing shrinks or wraps its own text anymore.
- The row itself now has `flex-wrap: wrap` (and `height: auto`) **unconditionally**, not just below 820px. If the row genuinely doesn't fit, it becomes two lines instead of clipping — the exact same safety net that already existed for phones, just no longer gated behind a width that assumed only phones could run out of room.

I can't spin up Safari here to prove the original bug byte-for-byte, so I proved the fix mechanically instead: I forced the same kind of extra width a different font's metrics would add (wider letter-spacing and padding on every button, comfortably enough to overflow) and confirmed the row wraps to two lines with every button fully visible — no clipping, no squeezed text — at both 1280px and 1440px. That check is now permanent, in `test/browser/editor.js`.

---

## Test results

```
test/*.js (15 files, dependency-free)           ALL PASS, 0 failures
test/browser/editor.js                          272/272 (270 existing + 2 new)
test/browser/template-overlap.js (new)          48/48
```

## What changed

- `public/site-fields.js` — `tagFields()` two-pass (explicit `field` wins over first-of-type); `deriveFields()` caps `role` (60 chars) and `summary` (220 chars) at a word boundary via a new `_truncateWords` helper.
- `site-templates.js` — `field: 'summary'` marked explicitly on Developer's and Freelance's real intro paragraphs; hero geometry (button/CTA y-position and section height) widened in Executive, Graduate, Studio, Bold, Developer, Consultant, Coach, Freelance — each by the actual measured worst-case overflow plus margin, not a round number.
- `public/app.html` — `.cv-top` gets `flex-wrap: wrap` and `height: auto` unconditionally (was phone-only); every real toolbar element gets `flex-shrink: 0` and `white-space: nowrap`; the phone-only media query rule is trimmed to just its remaining gap/padding tightening.
- `test/browser/template-overlap.js` — new, permanent overlap regression test across all 12 templates.
- `test/browser/editor.js` — new forced-overflow check proving the toolbar wraps instead of clipping/squeezing.
- `test/site-publish.js` — new source-level checks for the `tagFields` two-pass fix and the word-boundary length caps.

Keep the click-throughs coming — send the next round whenever you hit something.
