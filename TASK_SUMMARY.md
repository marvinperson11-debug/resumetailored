# TASK_SUMMARY — Homepage Style-&-Layout containment + CSP cleanup (Perf 83→90+, BP 92→100 attempt)

Date: 2026-08-09. Branch: `claude/markdown-file-response-y8qolt`.

Two targets, both diagnosed with real traces before coding (see `PERF_BP_DIAGNOSTIC.md`).

## UPDATE — Best Practices root cause found (the retired WebGL backdrop)

The CSP cleanup alone did **not** move BP off 92 (you confirmed: still `errors-in-console` + `inspector-issues`). I reproduced the console layer locally via CDP (`Audits` domain + console/pageerror capture) — clean in the sandbox — then found why it only shows on the **live mobile** run:

- The homepage has a retired dark WebGL backdrop, `<canvas id="neuro">`, hard-hidden by `#neuro { display:none !important }` in every theme. **But its script still ran** — creating a WebGL context and compiling shaders for a permanently-invisible canvas. It even contains `console.error('Neuro shader error…')` / `console.error('Neuro program link error…')`.
- On PageSpeed's **mobile** run (a software GPU / SwiftShader), a shader compile/link failure fires that `console.error` → **fails `errors-in-console`**, and the stray WebGL context is the kind of thing the Issues panel flags → `inspector-issues`. It never reproduced locally because headless `--disable-gpu` returns a null context, so the old code bailed before compiling.

**Fix (`index.html`):** the `#neuro` script now bails immediately when the canvas computes to `display:none` — *before* it touches WebGL. No context, no shader compile, no `console.error`. Bonus: it stops running a WebGL animation loop for an invisible canvas (a little less main-thread "Other" work). Verified with GPU **enabled** in puppeteer: `#neuro` computes to `display:none`, the guard bails, **0 console errors**.

Also hardened per your priority list: the deferred animation loader now has a `.catch()` (no unhandled-rejection surface); and the source was swept clean for the other culprits — no `eval`/`new Function`, no inline-handler CSP issues (`'unsafe-inline'` covers them), no deprecated `unload`/`beforeunload`, no sync XHR, no `document.write`.

**Expected:** this should clear both BP audits (→ 100) *if* the console error was the WebGL shader (by far the most likely, given it's the only `console.error` on the page and is mobile-GPU-specific). **If BP is still 92 after deploy**, the remaining suspect is GA4's own cookie/Signals Issues-panel warning (inherent to running GA on HTTPS) — at that point the exact text from DevTools → Issues would let me target it, or removing GA from the homepage would guarantee 100 at the cost of homepage analytics. `test/homepage-console-clean.js` guards the WebGL bail + loader `.catch()`. Full suite: **37 green.**

---

_Original two targets (unchanged, still in this PR):_

## Diagnostic recap (what the trace actually showed)

The homepage is **Style-&-Layout-bound, not render-blocking-bound**. Local mobile trace main-thread breakdown: **Style & Layout 2,290 ms**, Script Evaluation only 55 ms, render-blocking **none**. Inline CSS is just ~35 KB (not "270 KB"). So the planned "extract inline CSS to external" would not have helped (and risked FCP) — pivoted, with your approval, to CSS containment.

## Target 1 — Performance: `content-visibility` on below-the-fold sections

`public/index.html`: added `content-visibility: auto` to the **12 below-the-fold `<section>`s** (all direct children of `<main>`, **excluding `.hero`** — the LCP/above-the-fold element). The browser now skips style/layout/paint for each offscreen section until it's scrolled near.

- **Measured effect (local mobile trace): Style & Layout 2,290 ms → ~558 ms** (~75% less). Local Performance rose from ~86 to ~89–91 (absolute score is sandbox-noisy; the category delta is the real signal).
- **CLS kept at 0 (verified):** each section gets a per-section `contain-intrinsic-size: auto <Npx>`, where the fallbacks are the sections' **real heights measured at 412 px — exactly PSI's mobile viewport** (via puppeteer-core). The `auto` keyword makes Chrome remember each section's true rendered height after first paint. **A/B check in the same sandbox: baseline (no containment) CLS = 0.068, with containment = 0.068 — identical**, i.e. the change is CLS-neutral (the 0.068 is a local-sandbox artifact; your live PSI reads 0, and this change does not move it).
- **Safety constraints all held:** `test/homepage-motion-defer.js` still passes (no script change); hero LCP still CSS-animated (containment excludes `.hero`); nothing is CSS-hidden waiting on JS (`content-visibility` is not `display:none` — content stays in the DOM + a11y tree; reveals are an inline IntersectionObserver, unaffected); Accessibility re-verified **100**; SEO unaffected (content indexable).

## Target 2 — Best Practices: CSP cleanup (best-effort; may need one more round)

`security.js`: pruned the **dead AdSense/DoubleClick allowances** from the CSP — `pagead2.googlesyndication.com`, `*.googlesyndication.com`, `*.doubleclick.net`, `*.google.com` (script-src), the `*.googlesyndication.com`/`*.g.doubleclick.net` (connect-src), and the whole `frame-src` ad list (now just `'self'`). Grep-verified: **zero pages reference any of these** (AdSense was removed earlier), so this is safe and shrinks the header. Google Analytics keeps only its own hosts (`googletagmanager` / `*.google-analytics.com` / `analytics.google.com`).

**Honest status — this may not fully fix BP 92:** I could not read the live report from this environment (PSI API quota-exhausted; sandboxed Chrome can't reach the live URL). By audit weights, **92 ≈ 24/26**, pointing at `errors-in-console` + `inspector-issues` — a live **console error**. Dead allow-list entries don't themselves cause console errors (nothing requests them), so this cleanup is hygiene that *may* remove a stray CSP-blocked request but is **not guaranteed** to be the −8. **If PSI still shows 92 after deploy, please open DevTools → Console + Lighthouse → Best Practices (`errors-in-console` / `inspector-issues`) and paste the exact error** — then I'll ship a targeted fix. (One residual watch-item: if GA4 Google Signals is enabled at the property level it may ping `*.g.doubleclick.net`; with that now removed from the CSP a blocked ping would log a console error. If you see one, that's the fix — re-add just that endpoint.)

## Expected score lift

- **Performance:** 83 → **90+** likely (Style & Layout, the dominant cost, cut ~75%). Not guaranteed to hit exactly 100 — the page still has a large DOM (~1,772 nodes) and a fixed WebGL background; if it lands 88–92, the next lever is trimming DOM/decorative work.
- **Best Practices:** 92 → **100 if the −8 was ad-domain-related**; otherwise unchanged pending the live console output above.
- **Accessibility 100 / SEO 100:** unchanged.

## Tests

- `test/homepage-content-visibility.js` (new) — containment rule present, hero excluded, 12 `contain-intrinsic-size:auto` sizes, no `display:none` hiding.
- `test/security.js` — updated: CSP must keep GA/Anthropic/Stripe/ElevenLabs/fonts/cdnjs/esm.sh and must **no longer** contain the AdSense/DoubleClick hosts.
- Full suite: **36 files green.**

## Ready for review

Branch pushed; CI expected green. Per your plan you'll merge → deploy → run PSI Mobile 3× → send the median, and I'll record the final before/after here.
