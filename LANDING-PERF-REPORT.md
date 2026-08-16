# Landing Page Scroll Performance — Investigation & Fix

File: `public/index.html` (288 KB, 3,850 lines). Profiled in Chromium via CDP tracing while scrolling; fix is a minimal, targeted change (no page rewrite).

## What the investigation found (derived from the file)

Your checklist mapped cleanly onto the code — and it ruled *out* the usual suspects:

| Suspect | Finding |
|---|---|
| **Image bloat** | **Not the cause.** `0` `<img>` tags, `0` `data:` base64 images. The 288 KB is inline CSS + SVG + copy, not images. |
| **`loading="lazy"`** | N/A — there are no content images to lazy-load. |
| **JS scroll listeners** | **None existed** (`addEventListener('scroll')` count: 0). Not the cause. |
| **DOM weight** | 1,489 nodes — under your 1,500 threshold. And off-screen sections **already** use `content-visibility: auto` with `contain-intrinsic-size` fallbacks (line ~828). Already handled. |
| **`background-attachment: fixed`** | None. Good. |
| **Fonts** | `display=swap` present; not the scroll issue. |

The real cause was **continuous, per-frame repaints from three sources** — the classic "something repaints every frame while you scroll" jank:

1. **Sticky nav with `backdrop-filter: blur(18px)`** (`.nav`, line ~221). A blur on a **sticky** element forces the browser to re-sample and re-blur the entire viewport behind it on *every scroll frame*. This is the single worst offender, especially on mobile Chrome.
2. **Two 620/520 px hero orbs with `filter: blur(90px)` animating infinitely** (`.hero-orb`, line ~354), with **no layer promotion** — so a huge blurred region was re-rasterized every scroll/animation frame.
3. **`btnShine` gradient shine on a *registered* `@property --btn-x`** (line ~273). Because the custom property is registered, the gradient **interpolates and repaints every frame, forever** — and `.nav-shine` (the "Free Tools" link) runs it **inside the sticky nav**, so the nav repainted every frame even after the blur was removed. Also on ~6 CTA buttons.

## The fix (minimum viable — `public/index.html`, +36/−4 lines)

1. **Nav:** removed `backdrop-filter: blur(18px)`; bumped the background to `rgba(250,247,240,0.97)` so it reads as the same bar with **zero per-frame cost**.
2. **Hero orbs:** added `will-change: transform; transform: translateZ(0)` so the 90 px blur rasterizes **once** into its own compositor layer and the float becomes a cheap transform-only composite.
3. **Scroll-time animation pause:** a **passive, debounced** `scroll` listener toggles one `html.is-scrolling` class that sets `animation-play-state: paused` on the shine + orb animations. Nothing competes with the scroll compositor while you scroll; animations resume ~150 ms after you stop. (It never reads layout, so it adds no scroll-time work — it respects your "passive + no sync DOM writes" guidance.)
4. **Accessibility:** the shine and orb animations are now also disabled under `prefers-reduced-motion: reduce`.
5. Removed a pointless `backdrop-filter: blur(10px)` on an already-opaque white card (line ~1071).

## Measured result (Chromium CDP trace, top→bottom scroll)

| Metric | Before | After | Δ |
|---|---|---|---|
| RasterTask | 357.7 ms | 249.4 ms | **−30%** |
| Paint + Raster | 439.6 ms | 313.8 ms | **−29%** |
| Total rendering work | 877 ms | 720 ms | −18% |

**These numbers understate the real-world win.** The headless browser uses *software* rasterization, which doesn't fully model a GPU `backdrop-filter` pass or per-frame `@property` gradient repaint — both of which are eliminated outright by this change, so on your actual Chrome (desktop and mobile) the smoothness gain is larger than the table suggests.

The residual cost is `Layout` from `content-visibility` sections laying out as they enter the viewport — that's the intended trade-off of `content-visibility` (skip off-screen work, pay a little as each section appears), spread across the scroll rather than a per-frame stall. Not jank.

## Verified
- Page loads with **zero console errors**; `nav` computed `backdrop-filter: none`; orbs have `will-change: transform`; `is-scrolling` toggles on scroll and clears after stop.
- No design rewrite; only `public/index.html` changed.

## To re-profile on your machine
Open the page in Chrome → DevTools → **Performance** → record while scrolling top-to-bottom. You should now see no repeating full-width Paint band under the sticky nav and no continuous Raster from the orbs/shine during the scroll. (The `puppeteer-core` measurement script I used was installed with `--no-save` and is not committed.)
