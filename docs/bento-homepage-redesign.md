# ResumeTailored — Bento Grid Homepage Redesign

A premium, editorial **Bento Grid** homepage for ResumeTailored, built as a *Private
Career & People Office* dashboard rather than a generic SaaS landing page.

- **Live preview (interactive):** https://claude.ai/code/artifact/1b3546a1-3cd2-438f-a876-4056cc8b146b
- **Full source in the repo:** [`public/index-bento.html`](../public/index-bento.html) — a
  complete, self-contained page you can open directly or wire in as the homepage.

> **Stack note.** The brief's template said *"Next.js + Tailwind + shadcn/ui."* The
> actual ResumeTailored stack (per `CLAUDE.md`) is **plain HTML/CSS/JS with no build
> step and no framework** — `public/index.html` is served statically. So the deliverable
> is authored in that real stack: semantic HTML + a single scoped `<style>` block + ~30
> lines of vanilla JS. No new dependencies, nothing to compile. A Tailwind-config
> equivalent is included at the end for teams that do want it.

---

## STRICT CONSTRAINT — colors, gradients, shadows

Every value is pulled from the **existing** brand tokens (`public/index.html` `:root`,
`public/luxury-ecosystem.css`). **No new colors. No gradients. No drop shadows.** Depth is
built exclusively from **1px gold hairline borders, surface opacity, spacing, border
weight, and typography** — exactly as required.

| Role (brief) | Token | Exact value | Where it comes from |
|---|---|---|---|
| Deep Navy — page background | `--navy` | `#0a1628` | existing `--bg` |
| Deeper Navy — recessed band | `--navy-deep` | `#081422` | existing `--bg-alt` |
| Navy card surface | `--surface` | `#0d1e30` | existing `--surface` |
| Dark Teal — secondary surface | `--teal` | `#1a4d3a` | existing `--accent` (brand emerald) |
| Champagne Gold — accents/labels/CTAs | `--gold` | `#c9a227` | existing `--accent-2` / `--club-gold` |
| Warm Cream — headings/key text | `--cream` | `#f5f1e8` | existing `--ink` |
| Muted Cream — body copy | `--cream-muted` | `rgba(245,241,232,.64)` | cream at reduced opacity |
| Border Gold — hairlines | `--line` | `rgba(201,162,39,.22)` | existing `--line` |

Card surfaces alternate between **three opacities of the same two brand surfaces** to
create depth without a single gradient:

```css
--card-a:   rgba(13,30,48,.72);  /* navy card     */
--card-b:   rgba(26,77,58,.20);  /* teal-tinted   */
--card-deep:rgba(8,20,34,.66);   /* recessed navy */
```

Borders are the **only** depth mechanism and move through three states:

```css
--line:        rgba(201,162,39,.22);  /* resting hairline          */
--line-strong: rgba(201,162,39,.34);  /* emphasis / inner frames   */
--line-hover:  rgba(201,162,39,.50);  /* hover → 50% gold, per spec */
```

---

## Typography (preserved)

Both existing brand faces are kept, loaded from Google Fonts (the same request already on
the page):

- **Headlines:** `Fraunces` (display serif) — italic for emphasis (*"properly considered."*)
- **Body / UI:** `Inter` (sans)
- **Labels:** `Inter` 700, **12px, uppercase, `letter-spacing:.18em`, Champagne Gold**, each
  prefixed with a 26px gold hairline tick (`.eyebrow`).

---

## BENTO MAP

Desktop — **12 columns · 4 implicit rows · 20px gap**:

```
col →  1   2   3   4   5   6   7   8   9   10  11  12
┌───────────────────────────┬───────────┬───────────┐
R1│                           │ CANDIDATES│ EMPLOYERS │
  │        HERO  (6×2)         │   (3×2)   │   (3×2)   │
R2│                           │           │           │
  ├───────────────────────────┴───────────┴───────────┤
R3│              CINEMATIC SHOWCASE  (12×1)            │
  ├─────┬─────┬─────┬─────┬─────┬─────────────────────┤
R4│ AI  │COVER│INTVW│PRICE│PROOF│         CTA          │
  │ RES │ LTR │PREP │     │     │                      │
  │(2×1)│(2×1)│(2×1)│(2×1)│(2×1)│        (2×1)         │
  └─────┴─────┴─────┴─────┴─────┴─────────────────────┘
```

| Card | `grid-column` | `grid-row` | Surface |
|---|---|---|---|
| Hero | `1 / span 6` | `1 / span 2` | recessed navy + gold arc |
| For Candidates · 01 | `7 / span 3` | `1 / span 2` | teal-tinted |
| For Employers · 02 | `10 / span 3` | `1 / span 2` | navy |
| Cinematic Showcase | `1 / span 12` | `3` | recessed navy |
| Feature · AI Resume | `1 / span 2` | `4` | navy |
| Feature · Cover Letter | `3 / span 2` | `4` | teal-tinted |
| Feature · Interview Prep | `5 / span 2` | `4` | navy |
| Pricing | `7 / span 2` | `4` | teal-tinted |
| Social proof | `9 / span 2` | `4` | recessed navy |
| Final CTA | `11 / span 2` | `4` | **solid teal** (the one filled card) |

### One deliberate adjustment to the spans

The brief's literal spans — hero 6×2, **two audience 3×1**, showcase 12×1, three features
2×1, pricing/proof/cta 2×1 — sum to **42 grid cells**, which *cannot* tile a 12-column grid
without leaving a 6-cell hole. I promoted the two audience cards to **3×2** so they become
tall "doors" flanking the 2-row hero. That yields **48 cells → a flawless 4-row grid** and
reads more premium (the hero band becomes a self-contained 12×2 unit — hero + two doors).
Every other span is exactly as specified.

### Responsive collapse

- **≤1000px (tablet):** grid → **6 columns**, 16px gap. Hero stays 6×2; the two doors sit
  side-by-side (3 cols each) below it; showcase spans 6 and stacks its preview under the
  copy; the six utility cards tile **two per row** at 3 cols each. Nav links collapse to the
  hamburger.
- **≤680px (mobile):** **single column**, 12px gap. The **hero remains first and visually
  dominant**; every card is full-width in source order.

---

## Content & hierarchy (every card follows Label → Title → Description → Action)

- **Hero:** `THE OFFICE` → *"A private office for your ambitions."* (Fraunces italic on
  "ambitions") → 1-sentence pitch → **gold-outline CTA** (transparent bg, cream text) +
  quiet secondary link → trust meta (★★★★★ · Anthropic Claude · 100+ templates · no card).
  The **decorative gold arc** from the current hero is reborn as a low-opacity 3-ring SVG
  **inside the hero card only** (`opacity:.5 → .18`).
- **For Candidates · 01:** *"Tailor My Resume"* → 1 line → `FREE TO BEGIN` → `↗`.
- **For Employers · 02:** *"Recruiting Studio"* → 1 line → `PORTAL · FROM $49/MO` → `↗`.
- **Cinematic Showcase:** editorial **web-studio preview** rendered entirely from
  hairlines (a private personal-site mock — no imagery, no gradient, no shadow).
- **Features:** hairline-framed glyph → title → one line, for AI Resume / Cover Letter /
  Interview Prep.
- **Pricing:** large **"Free to begin"** (Fraunces) + smaller **"Pro $19.00 / month ·
  Lifetime $129"** + `↗`.
- **Social proof:** ★★★★★ + italic pull-quote + *"Rated 4.9 / 5 · 312 reviews"* (matches
  the existing `AggregateRating` schema).
- **Final CTA:** the single **filled teal** card — *"Step inside the office."* + gold
  `Get started free →`.

---

## Interactions (exactly as specced)

- **Hover:** border → `rgba(201,169,110,.50)` (50% gold) **and** `translateY(-2px)`, 200ms
  `ease-out`. **No `scale()`** — editorial, not playful. Arrows nudge `translate(3px,-3px)`.
- **Buttons:** on hover the gold border **fills with 10% gold** (`rgba(201,162,39,.10)`).
- **Focus:** `2px solid var(--gold)` outline with `3px` offset on every focusable element.
- **Scroll entrance:** staggered **fade-up** (opacity 0→1, `translateY(16px→0)`) via
  `IntersectionObserver`, **60ms** stagger, capped so late cards don't lag.
- **`prefers-reduced-motion: reduce`:** all reveals show immediately, all transitions off.

---

## Accessibility & polish

- **WCAG 2.1 AA** using existing colors only: cream `#f5f1e8` on navy `#0a1628` ≈ **15.8:1**;
  muted cream `rgba(245,241,232,.64)` on navy ≈ **7.4:1**; gold `#c9a227` on navy ≈ **7.6:1**
  — all pass AA (and mostly AAA) for their sizes.
- **Semantic HTML:** `<section>` for the grid region, `<article>` for non-navigational
  cards, `<a class="bento-card">` for cards that are links; `aria-hidden` on decorative
  SVG/glyphs; `aria-labelledby` wiring; the mobile drawer toggles `aria-expanded` /
  `aria-hidden`.
- **CLS:** the grid reserves its tracks up front (`grid-template-columns:repeat(12,1fr)` +
  `grid-auto-rows:minmax(150px,auto)`); the reveal animation only moves opacity/transform,
  never layout.

---

## Navigation (preserved and integrated cleanly above the grid)

All existing nav affordances are kept, restyled onto the navy/gold palette and sitting in a
sticky bar **above** the Bento grid:

- **Brand lockup** — "ResumeTailored / Private career & people office"
- **Primary links** — Membership · Tailor My Resume · For Employers · Examples · Journal
- **`中文` language toggle** — calls the site-wide `toggleLang()` (a no-op stub is included so
  the standalone file never errors before `site-nav.js` loads)
- **Login** — opens the existing Job-Seeker / Employer chooser
- **Hamburger** — full mobile drawer with `Esc`-to-close and focus-safe toggles

---

## How to wire it in

`public/index-bento.html` is complete and standalone — open it in a browser to review.

- **To preview alongside production:** it's already at `/index-bento.html` (served statically
  by `express.static`), so nothing else is needed to look at it live.
- **To ship as the homepage:** copy the `<head>` SEO/JSON-LD block from the current
  `public/index.html` into this file (it was trimmed here to keep the redesign readable),
  then swap the files. The nav's `toggleLang`, `openLogin`, and links already match the live
  routes, so the site-wide scripts (`site-nav.js`, `site-i18n.js`) attach unchanged.

---

## Optional — Tailwind equivalent

If a future rebuild moves to Tailwind, these are the only custom bits the layout needs:

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      colors: {
        navy:      '#0a1628',
        'navy-deep':'#081422',
        surface:   '#0d1e30',
        teal:      '#1a4d3a',
        gold:      '#c9a227',
        cream:     '#f5f1e8',
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans:  ['Inter', 'system-ui', 'sans-serif'],
      },
      borderColor: {
        line:        'rgba(201,162,39,.22)',
        'line-hover':'rgba(201,162,39,.50)',
      },
      gridTemplateColumns: { bento: 'repeat(12, minmax(0, 1fr))' },
      gridAutoRows: { bento: 'minmax(150px, auto)' },
    },
  },
}
```

```html
<!-- span utilities used by the grid -->
<div class="grid grid-cols-bento auto-rows-bento gap-5">
  <article class="col-span-6 row-span-2">…hero…</article>
  <a       class="col-span-3 row-span-2">…candidates…</a>
  <a       class="col-span-3 row-span-2">…employers…</a>
  <a       class="col-span-12">…showcase…</a>
  <a       class="col-span-2">…feature…</a> <!-- ×3 -->
  <a       class="col-span-2">…pricing…</a>
  <article class="col-span-2">…proof…</article>
  <article class="col-span-2">…final cta…</article>
</div>
```
