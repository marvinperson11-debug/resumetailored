# Website Builder v2 — V3a shipped (editor shell)

Built in the order you set: **foundation → selection → drag/resize.** You said not to let you rush me past the foundation, so I did something to make that structural rather than a promise.

## 1. Foundation — and it's independently tested

`public/site-doc-store.js` is a standalone module that loads as `window.SiteDocStore` in the browser **and** via `require()` in Node. That let me write **`test/doc-store.js` — 30 assertions, all passing — before the canvas existed.** The undo stack isn't trusted because I was careful; it's tested.

The editor never mutates a document in place. Every change goes through `apply(mutator)`: clone → mutate the clone → commit as a new **frozen** revision, pushing the previous one onto the undo stack. Undo/redo is a property of the data, not of the drag handlers.

Guarantees the tests hold it to:
- `getDoc()` is deep-frozen — callers can't corrupt state
- a **throwing mutator leaves the store untouched** (no half-applied edit)
- a **no-op edit creates no undo step** (no phantom history)
- **a whole drag collapses into ONE undo step** via coalescing tags — and `endGesture()` correctly separates consecutive gestures, and dragging a *different* element starts a new step
- history is **capped** so long sessions don't grow unbounded
- a **throwing listener can't break a commit**
- `replace()` (adopting a template) is itself undoable

## 2. Selection

Overlay boxes are computed **from the document** — cumulative section offsets plus element geometry — not by reaching into the iframe's DOM. That avoids cross-frame fragility entirely.

Click an element to select it: it gets a type tag and a resize handle, and the **inspector** opens with text, media (with upload straight into the media library), caption, label, colour, x/y/w/h, **hide-on-mobile**, and delete.

## 3. Drag / resize

Pointer events on the overlay move or resize the selection on a **10px grid**, clamped to the canvas. Each gesture applies through the store with a coalescing tag, so dragging an element 40 pixels is **one** undo step, not forty. The overlay follows the pointer live while the iframe re-renders debounced — so dragging stays smooth instead of thrashing the renderer.

## Preview parity holds automatically

The canvas renders through the **same `/api/personal-site/preview` endpoint** — and therefore the same renderer — as the published page, at a fixed 1200px width scaled to fit the stage. There's no separate "editor rendering" that could drift from production. `wcBuildConfig` now reads the editor's live document, so publish and preview always reflect what's on canvas.

## Verification

```
node test/doc-store.js       → 30/30 PASS   (foundation, UI-independent)
node test/preview-parity.js  → 18/18 PASS
node test/render-snapshot.js → link.html byte-identical
```
Plus: server syntax, inline scripts parse, `/site-doc-store.js` served, and every editor function + DOM anchor present.

## What's honestly not in V3a

- **Add Elements panel** (V4) — you can currently move, resize, edit and delete what a template gives you, but not yet add new elements from a palette. That's the next slice.
- Snap guides/alignment hints, multi-select, and keyboard nudge — V4 polish.
- I haven't been able to click the canvas in a real browser from here. The logic is tested and the wiring verified, but **first-hands-on feel (drag smoothness, handle ergonomics) is worth your eyes** once this is on Railway.

## Next: V4 — Add Elements panel + full element library

Drag new elements onto the canvas from a palette, with the gallery/portfolio elements as first-class citizens. The store already supports it — adding an element is just another `apply()`.

No blockers. Continuing unless you want to redirect.
