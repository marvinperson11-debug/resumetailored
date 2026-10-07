# Homepage page-speed investigation — Oct 7, 2026

## Headline
**I could not reproduce a ~24 s load, and nothing server-side or pathological explains one.** What I found instead is a fast server, a page whose remaining cost is main-thread layout work, and one real, cheap fix (a missing font preload) that I shipped. I am not claiming the 24 s is fixed — I could not find it.

## Step 1 — Measurements (before)
**PageSpeed Insights could not be run:** its API returns 429 "Queries per day exceeded" from this environment (same blocker earlier reports hit). So no official PSI numbers; please run PSI yourself for the field/lab numbers you want. What I measured instead:

| Measure | Result |
|---|---|
| Live TTFB `curl` (`/`, 5 cache-busted runs) | 0.32–0.41 s (0.6–1.1 s on some runs, which includes TLS from this sandbox) |
| Live HTML size | 338 KB raw → 72 KB brotli |
| Live assets (CSS/JS/fonts/other pages) | 0.30–0.39 s TTFB each, all 200, brotli, fonts cached 30 d |
| **Railway, last 7 days** (`http-response-time`) | p50 3–24 ms, p95 ≤ 69 ms, worst p99 453 ms; CPU ≈ idle (avg 0.0002 of 8 vCPU), memory 0.05–0.13 GB of 8 |
| Platform app `app.resumetailored.com` TTFB | 0.66–0.73 s (Next SSR + Clerk; fonts via `next/font`) |
| Local Lighthouse mobile, simulated throttling (3-run median) | score 96, FCP 1.66 s, LCP 2.56 s, TBT ~0, CLS 0.003 |
| Local Lighthouse mobile, **applied** 4× CPU + slow-4G (3-run median) | score 78, FCP/LCP 1.98 s, TBT 687 ms, **CLS 0.095**, TTI 8.5 s, main-thread 6.5 s (Style & Layout 3.0 s) |

## Step 2 — Where the time is (and isn't)
1. **TTFB / server: healthy.** Express re-reads and string-transforms the HTML per request, but compression is already tuned (output matches brotli quality 4; Node's default q11 would cost ~475 ms CPU on this file, so this is *not* the problem). Railway shows no latency or CPU spike across 7 days. A 24 s load cannot have come from the origin in this window — it was either a transient (cold start/deploy/edge) outside Railway's 7-day window, or client-side on a very slow device.
2. **HTML payload:** 338 KB raw is big but 72 KB on the wire; includes a 76 KB inline i18n/behaviour script and ~66 KB inline CSS. Moving them external would not change much (previous round measured the page as Style-&-Layout-bound, not render-blocking-bound — confirmed again).
3. **Images:** none (0 `<img>`), so nothing to convert; the LCP element is the hero `<h1>` text.
4. **Render-blocking:** `luxury-ecosystem.css` (3 KB br) is the only blocking resource and is needed for first paint; left alone. GA and the GSAP/ScrollTrigger/Lenis stack are already deferred to first interaction.
5. **Fonts:** self-hosted, `font-display: swap`, roman Inter/Fraunces preloaded — **but the hero `<em>` is italic Fraunces and that 81 KB file was not preloaded**, so it was discovered late and its swap-in caused layout shift. ← the real fix.
6. **Main thread (the real remaining cost):** Style & Layout ≈ 3 s under 4× throttle across 1,584 DOM nodes. `content-visibility:auto` already trims this on desktop; it is deliberately **disabled on mobile** because of a documented iPhone blank-section bug, so I did not touch it.

## What changed (`public/index.html`, homepage only)
- Added `<link rel="preload" … fraunces-italic-latin.woff2>` (href matches the `@font-face` src exactly).
- `back-nav.js` (a tiny teardown/no-op script at end of body) → `defer`.
- Test: `test/font-selfhost.js` asserts the italic preload, that it matches the `@font-face` src, and that the hero `em` is still italic Fraunces.

## After (local, same method as "before"; 3-run medians)
| | Before | After |
|---|---|---|
| Simulated FCP | 1.66 s | **1.25 s** |
| Simulated LCP | 2.56 s | 2.57 s (unchanged — sim LCP is noisy 1.97–2.59 s run to run) |
| Applied-throttle CLS | 0.095 | **0.023** |
| Applied-throttle FCP/LCP | 1.98 s | 1.95 s |
| Applied-throttle TBT / TTI | 687 ms / 8.5 s | ~755 ms / 8.6 s (within noise) |

**Acceptance criteria not fully met:** LCP is ≈ 2.5 s at the line in simulation and INP/TBT is dominated by layout work I did not restructure. Getting TTI/TBT materially lower needs reducing DOM/layout cost (fewer nodes above the fold, trimming the ~12 blurred template cards, or a mobile-safe `content-visibility` approach) — a design/structure tradeoff I did not make unasked. I did not hit metrics by removing content or lazy-loading the hero.

## Not changed / suspicious but left alone
- Cloudflare overrides origin `Cache-Control` on `.css/.js` to `max-age=14400` (4 h); versioned `?v=` URLs make that safe, but a 1-year browser TTL for versioned assets needs a Cloudflare setting, not code.
- HTML is re-read and re-transformed on every request (cheap today at ~3–24 ms server p50); caching the transformed output by mtime would make that free but wasn't a measured problem.
- Local Lighthouse is a proxy: absolute numbers differ from PSI/field data. Please re-run PSI after deploy and compare; I could not.
- No hero lazy-loading, no copy/design changes, no routes/auth/Stripe/GA4/JSON-LD touched.

## Verification
Full `test/*.js` loop passes (only `production-e2e.js` self-skips on Node 22). Post-deploy PSI re-measure still to do from your side (API quota blocks me).
