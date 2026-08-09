# TASK_SUMMARY — Desktop A11y 96→100 + mobile Perf render-blocking/LCP fixes

Date: 2026-08-09. Branch: `claude/markdown-file-response-y8qolt`. Traced first, then fixed.

## GAP 2 — Desktop Accessibility 96 → 100 ✅ (verified)

Lighthouse desktop flagged **`color-contrast`** on 5 elements (they render on desktop; mobile force-darkens inline faint text via a `@media` rule, which is why mobile was already 100):

| Element | Was | Now |
|---|---|---|
| `.hero-note`, `.demo-label` ×2, `.footer-copy` | `--ink-faint: #918A7E` (2.86–3.42:1) | **`--ink-faint: #6B6459`** (4.6–5.9:1 on every light bg) |
| `.feat-card` "Strong Match" + skill pills | `color:#22c55e` (2.27:1 on white) | **`#15803d`** (5.0:1) |

One CSS-variable change fixes all four taupe failures; the green is darkened in place. Re-ran Lighthouse: **desktop AND mobile Accessibility = 100, zero failing audits.**

## GAP 1 — Mobile Performance 96 → (render-blocking eliminated, LCP single-paint)

Traced a local mobile run (96, matching your PSI). The scored gaps were **LCP** and **FCP**, gated by **render-blocking CSS (~490 ms)**. Fixes, biggest-first:

1. **Eliminated render-blocking CSS** (the ~1,710 ms flag): the homepage loaded two blocking stylesheets — `site-fx.css` (319 ms) and `fonts.css` (169 ms).
   - `site-fx.css` is pure progressive enhancement (grain, cursor, reveal fallback, mobile sheets) → now loads async via `media="print" onload` (+ `<noscript>`). Nothing above the fold needs it.
   - `fonts.css` (1.7 KB of `@font-face`) is now **inlined into `<head>`** (`server.js`) — no request, no render block, and because the two above-the-fold faces are preloaded, first paint uses the real webfont (no FOUT, no swap-CLS).
   - **Result: render-blocking → 0, FCP 2.0 s → 1.4 s, CLS stays 0.**
2. **Fixed the LCP element re-paint.** The LCP element is `<p class="hero-sub">`. The inline i18n `applyLang()` ran on load and **unconditionally rewrote `innerHTML`** — and the hero-sub's HTML text differed from the English i18n string, so it genuinely re-painted *after* the script ran, pushing LCP past FCP. Fix: made the server-rendered hero-sub match the English string (no visible change — the JS already showed that text) **and** added a skip-if-identical guard to `applyLang` so the English pass is a no-op (less main-thread work too). A real throttled trace now shows the LCP element painting **once at ~0.5 s** (was re-painting).
3. **Sped up the hero entrance animation** (was staggered up to 740 ms + 0.8 s fade) → single quick fade, plus a `prefers-reduced-motion` guard.

### Honest note on the local number
After these, **local-Lighthouse mobile Perf = 97** and its *simulated* LCP stays 2.4 s **even though the real (throttled-Chrome) LCP is ~0.5 s** — Lighthouse's Lantern LCP estimate on localhost is pessimistic and doesn't respond to these DOM fixes. Every item PSI flagged is addressed (render-blocking removed, unused-JS was GA/beacon-only, long tasks reduced, non-composited hero animation sped up). Per your "stop when no more easy wins," the remaining lab-sim LCP gap needs the **field/PSI run on the deployed site** to confirm — the render-blocking elimination + single-paint LCP are real wins that the lab sim under-credits on localhost.

## Tests

- `test/homepage-a11y.js` — added: `--ink-faint` must clear 4.5:1 on white/cream/green/tan; no `color:#22c55e`.
- `test/font-selfhost.js` — updated for the inline `@font-face` (asserts self-hosted `@font-face` present and **no** render-blocking external `/fonts.css`).
- Full suite: **37 files green.** Desktop + mobile Accessibility re-verified 100; CLS 0.

## Expected after deploy

- **Desktop Accessibility → 100** (verified locally, deterministic).
- **Mobile Performance → up from 96** — re-run PSI Mobile to confirm; if LCP is still the holdout, its field value should be far better than the localhost lab sim.
