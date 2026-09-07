# Fix: sidebar (and two-column) band not filling every PDF page

## Problem
On the Sidebar templates, a resume long enough to span 2+ pages showed the
colored sidebar only where the text reached on later pages — the band stopped
mid-page instead of running to the bottom of every page.

## Root cause
In print, an element's background does **not** stretch to fill each page
fragment. The sidebar band was painted as a page background on `<html>`, but
without `background-attachment: fixed` most print engines paint a root
background **once** (page 1) rather than on every page — so pages 2+ lost the
band below where the text ended.

## Fix (Option A/B combined — the reliable one)
Paint the band as a **fixed** page background. A `background-attachment: fixed`
background in paged media is repainted on **every** page, so the band reaches
the bottom of each page no matter where the content ends:

```css
html {
  background: linear-gradient(to right, <sidebar-color> 215px, #fff 215px);
  background-attachment: fixed;
  background-repeat: no-repeat;
  background-size: 100% 100%;
}
body { background: transparent; }
@page { margin: 0; }   /* full-bleed so the 215px band lines up with the column */
```

- The sidebar's own colored column still paints page 1 exactly as before; the
  fixed band (same color) fills the remainder of every later page seamlessly.
- If a browser ignores `fixed` in print, it falls back to the old behavior
  (band on page 1) — so this is strictly an improvement, never a regression.

**Applies to all 8 sidebar variants automatically** — Sidebar, Sidebar Navy,
Forest, Crimson, Teal, Amber, Indigo, Charcoal — because they all share the one
`rSidebar` layout and the fix keys off the layout, not the color.

## Two-column templates
Checked. TwoCol's left column is **white** (no colored fill), so there was no
colored-band gap — only the thin accent **divider line** stopped where the text
ended. Applied the same fixed-background technique to draw that divider full
height on every page, and switched TwoCol print to full-bleed so the divider's
x-position lines up with the column. (All 8 TwoCol color variants, shared
`rTwoCol` layout.)

## Section breaks (Option C)
The renderer already wraps each experience/education entry in a
`page-break-inside: avoid` group, so individual entries don't split awkwardly
across a page break. Left as-is — no change needed.

## Files
- `lib/pdf.ts` — fixed-attachment page band for `rSidebar` and `rTwoCol`;
  TwoCol added to the full-bleed (margin 0) set.

## Test after deploy
Generate a 3+ page resume on **Sidebar Indigo** → PDF → confirm the band runs to
the bottom of every page (not just where text ends). Repeat on a couple of other
sidebar colors and a TwoCol template.

## Note / caveat
This relies on the browser's print engine honoring `background-attachment:
fixed` in paged media, which Chrome and desktop Safari do. If you test on **iOS
Safari** and a later page still clips, that engine has weaker paged-background
support — tell me and I'll move to the heavier Option A (measure content and
emit explicit fixed-height page containers), which works everywhere but is more
invasive. The current fix is the clean one and should cover normal desktop
"Save as PDF".
