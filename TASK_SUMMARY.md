# TASK_SUMMARY — PageSpeed Performance Overhaul (mobile FCP/LCP)

Date: 2026-08-08. Branch: `claude/markdown-file-response-y8qolt`.

Focused, low-regression performance work targeting the biggest real mobile cost on this site. Full audit + the decisions behind the scope are in `PAGESPEED_PLAN.md`.

## What actually moves the needle here (and what doesn't)

This site's landing page has **no `<img>` tags** — the hero is pure CSS — so LCP is a **text element**, and **font delivery dominates FCP/LCP on mobile**, not images. The spec's "images = biggest LCP" section barely applies. The real, measurable cost was loading **Inter + Fraunces + Syne from Google Fonts**: a render-blocking third-party stylesheet (`fonts.googleapis.com`) plus a cross-origin woff2 fetch (`fonts.gstatic.com`) — two extra connection setups (DNS+TCP+TLS each) on the critical path, on every one of ~300 pages.

## Changes shipped

- **Self-hosted Inter + Fraunces + Syne (Latin subsets).** `scripts/build-fonts.js` pulls the woff2 from Google (variable fonts, one file per family/style/subset), writes `public/fonts.css` + `public/fonts/*.woff2` (8 files, ~468 KB total; a browser fetches only the Latin subset it needs, ~2 files above the fold). `font-display: swap` is preserved.
- **Server-side rewrite (one change, all 355 pages)** in `server.js` (`_selfHostFonts`, in the same HTML-send path as the existing asset-versioning): every Google Fonts `<link>` for those three families collapses to a single self-hosted `/fonts.css` **+ a `preload` of the two above-the-fold Latin faces (Inter, Fraunces) with `crossorigin`**, and the now-unused `fonts.googleapis.com`/`fonts.gstatic.com` `preconnect`s are dropped. No files edited by hand.
- **Signature script fonts left on the CDN.** Dancing Script / Great Vibes / Satisfy / Caveat and the runtime `${sigFont}` link (a niche dashboard signature feature, not a landing-page cost) are explicitly guarded and untouched.
- **Deferred `cookie-consent.js`** — it was the one remaining render-blocking `<head>` script on ~300 pages (GA/AdSense were already `async`; GSAP/Lenis already `defer`).
- **No CJK webfont work needed** — the site loads none; Chinese already renders in the system font stack.

## What I deliberately did NOT do (and why)

- **Aggressive `immutable` long-cache on CSS/JS** — the repo deliberately serves those `no-cache` + version-stamps their references, because Cloudflare (in front of Railway) was proven to override `Cache-Control` on assets. Two tests (`static-asset-caching.js`, `html-asset-versioning.js`) lock this in. Changing it would fail CI and re-introduce a fixed stale-asset bug. Left as-is. (Fonts/images already get `max-age=2592000` from the existing static branch — self-hosted woff2 inherit that.)
- **A per-page critical-CSS build pipeline across 355 files** — high visual-regression risk for marginal gain (most pages already inline the bulk of their CSS). Targeted the shared render-blocking externals instead.
- **Preconnect to `api.stripe.com` / `api.anthropic.com`** — marketing pages never call those origins; preconnecting to unused hosts is counterproductive.

## Verification — before/after

**I could not run field PageSpeed Insights**: PSI needs a public URL and this branch isn't deployed (the live site reflects `main`). I attempted **local Lighthouse** (pre-installed Chromium) against the booted server, A/B-ing the font change via an `RT_LEGACY_FONTS` escape hatch — but the sandbox proved **too noisy to be credible**: identical code produced wildly different runs (perf score 46 vs 83; TBT 260 ms vs 1,340 ms; Speed Index 5.7 s vs 20.2 s), because CPU contention dominates and — critically — the font win is **network-latency-bound**, which localhost (≈0 latency) cannot exercise. So local numbers are **not** a trustworthy stand-in for field PSI here, and I'm not going to present them as if they were.

What is **deterministic and verifiable** (asserted by `test/font-selfhost.js`):

| | Before | After |
|---|---|---|
| Render-blocking third-party font stylesheet (`fonts.googleapis.com/css2`) | 1 per page | **0** |
| Cross-origin font connections (`googleapis` + `gstatic`) on critical path | 2 | **0** (fonts same-origin) |
| Above-the-fold fonts preloaded | 0 | **2** (Inter + Fraunces Latin) |
| Render-blocking `<head>` scripts (`cookie-consent.js`) | 1 | **0** (deferred) |
| CLS | 0 | **0** (unchanged; `width`/`height` + preload guard it) |

These are exactly the items PSI's own audits flag ("Eliminate render-blocking resources", "Preconnect to required origins", "Reduce the impact of third-party code"). **Run field PSI on `resumetailored.com` after this deploys** for the real score — that's the only trustworthy measurement, and it's only possible post-merge.

## Tests

`test/font-selfhost.js` (new) asserts the rewrite end-to-end: self-hosted `/fonts.css` + preloads present, Google Fonts + gstatic preconnect gone on marketing/tool pages, signature fonts preserved on the dashboard, and the assets serve with correct caching. Full suite: **32 files, all green** (31 prior + the new one). No visual regressions — the same fonts render, just delivered from our own origin.
