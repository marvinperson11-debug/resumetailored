# Website Builder v2 — V2 shipped (template gallery + legacy creator deleted)

The "no live users" call simplified this a lot. I took it — the v1 creator is **gone**, not parallel-maintained.

## The rip-out

**Removed (~740 lines):**
- **server:** `_renderSiteGrid`, `_renderSiteBlock`, `_SITE_THEMES` (the v1 grid renderer and its background-swatch system), and **all legacy branching** in `_renderPersonalSite`. There is now exactly one renderer. A site row without a v2 document renders a small "not built yet" placeholder — no legacy path exists to fall back to.
- **app.html:** the entire block-list editor — palette, block cards, drag-reorder, width picker, background swatches, per-block gallery/case-study editors — plus **125 now-dead i18n key occurrences**.

**Kept (and still tested):** media library + quotas, lead capture, analytics, QR, Back Office, text-video + voiceover, publish plumbing, `_renderResumeFragment`.

Net result: **−132 lines overall**, *including* the 4 new templates and the gallery. Deleting v1 more than paid for v2.

## The 4 templates

Real, structurally distinct site documents — not colour variants:

| Template | Category | Structure |
|---|---|---|
| **Executive** | Professional CV | Dark hero + circular headshot, credential strip (3 stats), full experience section, contact band with form + social |
| **Grid Portfolio** | Portfolio | Typographic hero, **6-item masonry work grid**, about with image box, contact — **multi-page** (Work + About) |
| **Bold** | Creative | Oversized type **overlapping a colour block**, slider showcase, full-bleed statement band, contact |
| **Consultant** | Business | Light gradient hero, services 3-up cards, case studies on dark, contact with **QR code** |

All on the indigo→violet brand palette. Image slots use **self-contained gradient placeholders** (`props.ph`) — no binary assets, nothing to 404, and each is one click from a real upload.

## The gallery

Category tabs (All / Professional CV / Portfolio / Creative / Business) → template cards → **preview modal with the desktop/mobile toggle before you pick** (you flagged this as important; it's a live iframe re-widthed to 980px / 390px) → "Use this template."

Critically, that preview renders through the **same `_renderSiteDoc`** as the published site — so what you evaluate in the gallery is what visitors get.

Publish and Preview both refuse politely until a template is picked, rather than silently producing an empty page.

## Verification

- `preview-parity.js` → **18/18 PASS**, now including **preview === public for all 4 templates** and "no document → placeholder, **no legacy renderer**"
- `render-snapshot.js` → **`link.html` byte-identical** — the Create-a-Link guarantee survived the whole rip-out
- app.html inline scripts parse; **zero dangling references** to the removed editor
- **E2E over HTTP:** catalogue lists all 4 → template preview renders → pick → publish → live site serves 4 sections with mobile stacking and a working slider gallery

## One process note

My first removal script over-reached — `wcBuildConfig` happened to sit *after* the text-video and Back Office code, so a brace-match from it swallowed those too. I caught it on the post-removal check, restored from git, and redid the removal keyed on explicit function names instead. Nothing lost, but worth flagging since I'll be doing more surgery like this in V3.

## Next: V3a — editor shell

Per your instruction, **undo/redo is foundational, not bolted on**: the shell gets an immutable document + snapshot stack in its first commit, before any drag handler exists. Then selection, drag/resize/snap on the canvas, and the inspector — with the canvas rendering through the same renderer plus an editing overlay, so preview parity holds automatically.

No blockers, no questions. Continuing to V3a.
