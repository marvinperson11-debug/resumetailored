# Website Builder v2 — V4 shipped (Add Elements panel + full element library)

You called this "straightforward wiring." Mostly it was — the store carried the weight, exactly as designed. But it surfaced a real bug, and the way it surfaced is worth reading.

## What shipped

**Add Elements panel — 21 entries in 6 groups:**

| Group | Elements |
|---|---|
| Text | Heading, Subheading, Paragraph |
| Media | Image, Image box, Video, Audio |
| **Gallery** | **Grid, Masonry, Slider** |
| Interactive | Button, Contact form, Request-résumé form, Social icons, Page menu |
| Layout | Box, Divider, Spacer |
| **ResumeTailored** | **Résumé, Case studies, QR code** |

**Real drag-and-drop onto the canvas** — the overlay is a drop target: it converts the drop point into canvas space, finds the section under it, inserts there, and **grows the section** if the element would overflow the bottom. Click-to-add also works (placing below the current selection), so the palette is usable without a drag. Plus **"+ Add section"** for new bands.

**Inspector now covers the whole library** — text/align/colour, media with upload, caption, label, button link (URL *or* page) and style, form mode, box background/radius, divider thickness, gallery layout/columns with per-item title/upload/remove, social links, case-study cards. Array edits coalesce, so typing a title is **one** undo step, not one per keystroke.

And because everything routes through the V3a store, **every add, edit and delete is undoable** with no extra work. That part really was just wiring.

## The bug — and how it nearly got past me

**Video and audio elements with no `src` rendered nothing.** So dropping "Video" from the palette would have added an element you couldn't see. They now render a dashed empty-state block (**"Add a video" / "Add audio"**, localised) that's visible and selectable until you pick a source.

The part worth flagging: **my new test initially passed on the broken code.** The wrapper counter matched the prefix `sd-el`, which also matches `sd-elabel` — so label divs were being counted as elements, and the count landed on the expected number by coincidence. I only caught it because I checked video/audio directly instead of trusting a green test.

Two fixes: the counter now anchors on the character that terminates the class name, **and** each palette entry is rendered in isolation so an empty render is attributed to the exact entry that caused it. A test that can't distinguish a label from an element isn't a test.

## New guard: `test/element-library.js`

It parses `ED_PALETTE` straight out of `app.html` and asserts **every entry renders through the production renderer**. That closes the structural gap where the editor could offer something the renderer can't draw — the class of bug above, permanently.

## Verification

```
node test/doc-store.js       → 30/30 PASS
node test/element-library.js → 29/29 PASS   (new)
node test/preview-parity.js  → 18/18 PASS
node test/render-snapshot.js → link.html byte-identical
```

## Where the rebuild stands

- ✅ V1 document model + single renderer + preview parity
- ✅ V2 template gallery (4 templates), legacy creator deleted
- ✅ V3a editor shell — immutable store, undo/redo, selection, drag/resize
- ✅ **V4 Add Elements panel + full element library**
- ⏭️ **V5** multi-page management (add/rename/reorder pages; the nav element and `/site/:name/:page` routing already work)
- V6 mobile per-element overrides · V7 migration/i18n/polish

## Recommendation

The builder is now functionally complete enough to be worth **your hands on it**. Everything from here (page management, mobile tweaks, polish) benefits from you having actually dragged an element around first — and drag feel is the one thing I can't evaluate from here.

**I'd suggest merging PR #266 to Railway now** and giving it a real click-through. If it feels wrong, better to find out before I build two more layers on top. Say the word and I'll merge, or I'll continue to V5 if you'd rather keep going.
