# Website Builder v2 — V1 shipped (model + renderer + preview parity)

All five answers locked in, both of your additions accepted, and V1 is built on the branch.

## Your additions — both taken, one earlier than you asked

**Mobile auto-layout moved earlier.** You asked for it by V2 (with the template gallery). It's in **V1**, because it belongs in the renderer, not the editor — and the renderer is what I just built. Elements are emitted in reading order (sorted by `y`, then `x`) and the mobile stylesheet drops them to static full-width flow. That means a template stacks correctly on a phone **by construction**, before a single template exists. `hide-on-mobile` is honored now; the advanced per-element mobile tweaks stay in V6 as you said.

**Undo/redo is foundational in V3a.** Agreed — grafting an undo stack onto a live canvas is how you get subtly-corrupt documents. The editor shell will be built on an immutable document + a snapshot stack from its first commit, before any drag handler exists.

## What V1 delivers

**Site document model** — `config.pages`:
```
pages[] → sections[] → els[] { type, x, y, w, h, z, mhide, props }
```
Elements sit on a 1200px design canvas. `x`/`w` are emitted as **percentages** so the canvas is fluid; `y`/`h` stay px for vertical rhythm.

**`_renderSiteDoc`** — the single renderer:
- Sections stack vertically, each owning its background (colour / gradient / image); elements are **absolutely positioned inside a section**, so they can go anywhere, overlap, and layer — the model you approved.
- **Mobile auto-stacking** built in (above).
- Element renderers implemented: heading, subheading, paragraph, image, imagebox, **gallery (grid / masonry / slider, with captions + links)**, video, audio, button, social, form, divider, box, spacer, nav, resume, case studies, QR. Untrusted URLs and geometry are validated and clamped.

**Multi-page** — `/site/:name/:page` live alongside `/site/:name`, confirmed scheme. An unknown page slug **404s** rather than silently serving home. The nav element links pages; buttons can target a page, an anchor, or a URL.

**Preview parity — the structural fix.** The preview endpoint now renders through the *same* `_renderSiteDoc` as the public page, and takes the real subdomain + page so output matches exactly. New `test/preview-parity.js` asserts **preview `<body>` === public `<body>` for every page**, and fails with a character-level diff if they ever drift.

## Verification

```
node test/preview-parity.js     → 9/9 PASS
node test/render-snapshot.js    → link.html, site.html, site-grid.html byte-identical
```

Parity test covers: publish, preview==public for **both** pages, v2 renderer actually in use, mobile stacking present, reading order correct, multi-page nav, unknown-page 404, and **legacy `config.blocks` sites still rendering the v1 grid**.

**Proof the core complaint is fixed** — I rendered a v2 page and inspected the `<body>`:
- resume-document card present: **no**
- real masonry gallery: **yes**
- designed sections with positioned elements: **yes**

That's the difference between "a résumé on a background" and a website.

## Nothing user-facing changed yet

Deliberately. This pass is model + renderer + test. The current creator is untouched and still live for your Pro users, per your cutover decision. Legacy sites render exactly as before, and Create-a-Link is byte-identical.

## Next: V2 — template gallery

Building the 4 templates you picked — **Executive**, **Grid Portfolio**, **Bold**, **Consultant** — each a complete multi-section site document with real sample copy, inline SVG/gradient placeholder art, and our indigo→violet palette. Plus the gallery UI itself: category tabs, hover preview, **desktop/mobile toggle before picking**, and "start from this template."

Because mobile auto-stacking already landed, every template will be phone-correct the moment it exists — which was your point.

No questions blocking me. Starting V2 unless you want to redirect.
