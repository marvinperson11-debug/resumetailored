# Website Builder v2 — V5 merged, V6 shipped (per-element mobile overrides)

V5 is merged to `main` (`5ac9b4f`) and deploying. V6 is built on the branch.

## V6 — mobile overrides

Automatic mobile stacking landed back in V1. V6 adds the controls for when the automatic result **isn't** what you want.

**Model:** `el.mobile = { order, w, align, hidden }` — all optional. Absent values keep the automatic behaviour, so nothing changes for elements you never touch.

**Renderer:**
- **Stack order** — default stays reading order (y, then x); an explicit `mobile.order` overrides it, so you can restack a section for phones **without disturbing the desktop layout**.
- **Width & alignment** — emitted as a small stylesheet inside the existing mobile media query, keyed on a per-element class.
- **Hidden** — `mobile.hidden` joins the original `mhide`; both honoured.

**Editor:**
- Inspector gains a **📱 Mobile** section: hide on mobile, width (full / 75 / 50 / 33%), alignment, and stack-order nudges with reset-to-auto.
- Canvas gains a **desktop/mobile device toggle** that re-renders the iframe at 390px so overrides are visible while editing. The selection overlay hides in mobile view, since desktop geometry doesn't apply there.
- Full EN/中文.

## A trap I avoided

My first implementation named the generated CSS classes from a **running counter**. That would have made the same document render **differently on every call** — and preview parity would have silently broken, because preview and the published page are two separate renders.

Class names are now **derived from the element id**, so rendering is deterministic. The parity test asserts it explicitly: `mobile classes are deterministic (id-derived)`.

I caught it before wiring rather than after, which is the one advantage of having built the parity guarantee first.

## Verification

```
test/doc-store.js        30/30 PASS
test/page-ops.js         51/51 PASS
test/element-library.js  29/29 PASS
test/preview-parity.js   23/23 PASS   (+5 mobile-override assertions)
test/render-snapshot.js  link.html byte-identical
```

The five new assertions: preview === public *with* overrides applied, order restacks the DOM, width/align rules are emitted, hidden elements are flagged, and class names are deterministic.

`site-doc.html` was re-baselined for exactly **one whitespace line** — the slot where mobile rules are injected. I diffed it to confirm that's all that changed.

## Where the rebuild stands

- ✅ V1 document model, single renderer, preview parity
- ✅ V2 template gallery, legacy creator deleted
- ✅ V3a editor shell — immutable store, undo/redo, selection, drag/resize
- ✅ V4 Add Elements panel + full element library
- ✅ V5 multi-page management *(merged)*
- ✅ **V6 per-element mobile overrides**
- ⏭️ **V7 — polish**, which is the phase I'd most like your click-through to steer

## What's left, and why I'd rather wait

V7 is the last planned phase and it's entirely polish: snap guides and alignment hints, keyboard nudge, multi-select, page-manager drag-reorder, and whatever the editor turns out to need in practice.

That list is my guess. **Your click-through is worth more than my guess here** — if drag feels laggy or the snap grid fights you, those are V7 items that outrank anything on my list.

So: V6 is on the branch, unmerged. I can merge it whenever you like, and I'd suggest holding V7 until you've reported back on drag feel, the snap grid, handle size, and the page manager.

No blockers. Just no more guessing worth doing until you've used it.
