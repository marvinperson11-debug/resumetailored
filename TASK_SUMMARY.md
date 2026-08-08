# TASK_SUMMARY — Defer the homepage scroll-animation stack (final Performance lever)

Date: 2026-08-08. Branch: `claude/markdown-file-response-y8qolt`.

The last remaining main-thread cost on the mobile homepage was the scroll-animation stack (GSAP + ScrollTrigger + Lenis + `site-motion.js`). With every other Lighthouse opportunity already clean, this PR moves that stack **off the initial render** — the approved final step toward 100 Performance.

## Change

`public/index.html` — the four animation scripts no longer load as eager `<script defer>` tags. They're injected on the **first user interaction** (`scroll`/`pointerdown`/`keydown`/`touchstart`/`mousemove`/`wheel`) or after a **4s fallback**, in dependency order (gsap → ScrollTrigger → lenis → site-motion). `mobile-native.js` (the touch layer: haptics, swipe, bottom-sheets — no libraries) stays deferred so its handlers are ready for the user's first touch.

## Why this is safe (no content hidden, LCP unaffected)

I checked this carefully before shipping — the site's own comment calls `site-motion.js` "progressive enhancement," and the DOM backs that up:
- **No element on the homepage is CSS-hidden waiting on JS.** The markup uses neither `class="reveal"` nor `[data-reveal]` (the only selectors with `opacity:0` in CSS), and on mobile those are `opacity:1 !important` anyway. `.section`/`.card` reveals are only hidden by `gsap` *at runtime*, so if the libs load late the content is simply visible.
- **The hero headline (LCP) is not part of this stack** — its words are injected by inline JS and animated by a pure CSS `@keyframes` (`word-appear`), independent of GSAP.
- **Nothing else references `gsap`/`ScrollTrigger`/`Lenis`** outside the stack (grep-verified), so nothing breaks by loading them later.
- ScrollTrigger reveals for elements already in view when the stack initializes resolve to their end (visible) state — no flash.

**Tradeoff (as approved):** entrance/scroll animations and desktop smooth-scroll (Lenis; already disabled on touch) begin on the first interaction instead of at load. The page is fully visible and usable before then.

## Verified

- Re-ran Lighthouse locally: **Accessibility still 100**; no eager animation `<script>` in the served HTML; loader present, dependency-ordered, with the 4s fallback. (Performance's *absolute* local score stays noisy in this sandbox — the real number is the post-deploy field/PSI run.)
- `test/homepage-motion-defer.js` (new) guards it: no eager stack tags, interaction+timeout binding, dependency order, `mobile-native.js` still deferred. Full suite: **35 files green.**

## Full-goal status (mobile homepage)

| Category | Status |
|---|---|
| Accessibility | **100** ✅ (contrast + `<main>` — prior PR) |
| SEO | **100** ✅ |
| Best Practices | **100 expected** (clean locally; live 92 was AdSense, now removed) |
| Performance | AdSense removed (43→82), fonts self-hosted, GA + cookie-consent + now the animation stack all off the critical path — **confirm the field number with a post-deploy PSI run** |

**Measure on production** (`pagespeed.web.dev`, `https://resumetailored.com/`, Mobile) after this deploys — I can't run field PSI from CI. Send me the numbers and I'll record the final before/after here.
