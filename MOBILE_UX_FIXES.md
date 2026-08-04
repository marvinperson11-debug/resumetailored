# Mobile UI/UX Bug Fixes

Feature work paused. All six reported bugs fixed on branch **`claude/mobile-ux-fixes`** → PR. Full test suite (21 files) green. Every visual fix is scoped to `@media (max-width: 820px)` (or the specific mobile component), so **desktop is untouched** — except Bug 2 (back button), which you asked to apply to both.

## Bug 1 — Career Dashboard save didn't refresh *(mobile, but was actually all viewports)*
**Root cause found:** in the profession picker's save handler (`public/career-hub.js`), `closePicker()` ran *before* the re-render callback was captured — and `closePicker()` nulls `pickerOnSet`, so the callback was always `null` and never fired. That's why the dashboard kept showing the old profession until a manual reload.
**Fix:** capture the callback first, then close, then fire it. After a successful `POST /api/profession` the active tool (the Dashboard) now re-fetches and re-renders immediately.

## Bug 2 — Back button dumped to the landing page *(desktop + mobile)*
**Root cause:** the SPA never pushed history entries when switching tabs, so the browser Back button had nothing in-app to pop and always left the app.
**Fix (`public/app.html`):** `showTab()` now pushes a history state per tab (state only, URL unchanged so nothing else breaks); the first switch *replaces* the page-load entry. A new `popstate` handler restores the tab on Back/Forward (suppressing the push so it doesn't loop). When in-app history is exhausted, Back leaves to the previous page as expected. Works on desktop and mobile.

## Bug 3 — Low text contrast on cream *(mobile)*
Two causes, both fixed:
1. **Ghosted sections** (FAQ headings, job-board lists, labels) were `[data-reveal]` scroll-reveal elements stuck near-invisible because the reveal trigger never fired on mobile. `public/site-fx.css` now forces `[data-reveal]` fully visible at ≤820px (same as the reduced-motion fallback).
2. **Genuinely light tokens** — `--ink-soft #57514A`, `--ink-faint #918A7E`, and inline `#9ca3af/#94a3b8/#818CF8` grays — are darkened to `#2d2d2d`/`#4a4a4a` on mobile in `theme.css` (shared SEO pages), `index.html` (self-contained), and `style.css` (the app). Purple/lavender chip text is included in the darken list.

## Bug 4 & 5 — "NO ACCOUNT REQUIRE[D]" cutoff / FREE pill overlapping text *(mobile)*
**Root cause:** the "✓ Free" / "✦ Pro Exclusive" pill is an absolutely-positioned `::after` corner badge, and the wide uppercase eyebrow ran underneath it.
**Fix (`index.html`):** on mobile the pill is pulled fully into the corner and the eyebrow gets `padding-right: 96px` so it wraps clear of the badge — a badge never covers text now. (App-side sidebar/Career-Hub pills already use `margin-left:auto` + flex, so they don't overlap.)

## Bug 6 — Floating content / no section boundaries *(mobile)*
- White cards get a light `1px solid rgba(0,0,0,0.06–0.08)` edge on cream (`theme.css`, `index.html`, `style.css`).
- Form fields/textareas get a clearly visible `1.5px` border + white fill so users see where to tap (`style.css`).
- Long unbreakable strings (e.g. `yourname.resumetailored.com`) now wrap instead of overflowing their card, and `overflow-x` is locked on mobile — this also fixes the right-edge text cutoff on the "Personal Website Builder" card.

## Files
`public/career-hub.js` (Bug 1), `public/app.html` (Bug 2), `public/site-fx.css` (reveal), `public/theme.css` (shared SEO pages), `public/index.html` (landing, self-contained), `public/style.css` (the app).

## Testing note
The Node suite (21 files) is green, but these are **visual** fixes and this environment has no mobile browser. Please verify on your phone — especially: (1) change profession on the Dashboard → it updates without reload; (2) navigate a few tabs → Back steps through them; (3) the ATS/landing/job-board pages read clearly with visible card/field borders and no FREE-pill overlap or right-edge cutoff.

If any specific element is still faint (e.g. a particular lavender chip on one page I couldn't see), screenshot it and I'll target it precisely — a couple of the SEO pages have their own inline styles that may need a one-line follow-up.
