# Hero mobile fix (attempt 4) — applied, NOT committed

Waiting for your confirmation before commit/push, per your instructions.

## 1. Mobile `.c-hero` block — applied verbatim

Removed all prior `.c-hero` rules from the existing `@media (max-width:680px)` block
(including `.c-hero` from the shared single-column selector) and added your exact block as a
new `@media (max-width: 680px)` query. Diff of the `.c-hero` section:

```diff
     /* Single column — hero remains first & dominant */
-    .c-hero,.c-cand,.c-emp,.c-show,
+    .c-cand,.c-emp,.c-show,
     .c-f1,.c-f2,.c-f3,.c-price,.c-proof,.c-cta{
       grid-column:1 / -1;grid-row:auto;
     }
-    .c-hero{
-      min-height:0!important;
-      justify-content:flex-start!important;
-      padding:22px;
-      gap:12px;
-    }
-    .c-hero > *{margin:0!important}
-    .c-hero .card-title{font-size:34px}
     .c-door{min-height:190px}
     .c-cta{min-height:170px}
   }
+
+  @media (max-width: 680px) {
+  .c-hero {
+    grid-column: 1 / 13 !important;
+    grid-row: auto !important;
+    min-height: 0 !important;
+    height: auto !important;
+    max-height: none !important;
+    justify-content: flex-start !important;
+    align-items: flex-start !important;
+    padding: 22px !important;
+    gap: 12px !important;
+  }
+  .c-hero__arc,
+  .c-hero svg {
+    width: 120px !important;
+    height: 120px !important;
+    top: -15px !important;
+    right: -15px !important;
+    opacity: 0.1 !important;
+  }
+  .c-hero * {
+    margin-top: 0 !important;
+    margin-bottom: 0 !important;
+  }
+  .c-hero .eyebrow    { margin-bottom: 8px !important; }
+  .c-hero .card-title { margin-bottom: 10px !important; }
+  .c-hero .card-desc  { margin-bottom: 14px !important; }
+  .c-hero .hero-cta   { margin-bottom: 10px !important; }
}
```

## 2. `.bento-intro` above the grid — confirmed absent (grep: none).

## 3. Hero `<article>` inline style — confirmed none:
`<article class="bento-card bento-card--lg c-hero reveal" aria-labelledby="bento-title">`

## Content fixes

- **H1 spacing** — confirmed: `Your next move, <em>properly considered.</em>` (space after comma).
- **"What's New"** — confirmed: does not exist anywhere in the file.
- **Pricing card** — now renders the exact string with proper spacing:
  `Free to begin · Pro $19.00 / month · Lifetime $129`
  Markup: `<h3 class="price-line">Free to begin · <b>Pro $19.00</b> / month · Lifetime $129</h3>`
  (Removed the old two-part `price-big` + `price-sub` structure so nothing duplicates or
  runs together. `Pro $19.00` is gold-emphasized.)

## Automated verification (all true)

```
hero H1 spaced .............. true
no "Freetobegin" ............ true
pricing exact line .......... true
no price-big/price-sub ...... true
"What's New" absent ......... true
bento-intro absent .......... true
hero article no inline style. true
```

## Waiting

Reply **"confirmed"** and I'll commit + push to PR #424, then send the fresh Netlify preview
URL.

### One note (not a change I made on my own)
The pricing card previously showed a large "Free to begin" headline with the plan line
beneath it. Your exact string is a single line, so I collapsed it to one line at 22px. If you
want the big "Free to begin" emphasis back *and* the full string, tell me and I'll split it
into a headline + sub-line again.
