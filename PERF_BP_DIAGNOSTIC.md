# Diagnostic Report — Performance 83→90+ and Best Practices 92→100

_Step 1 as requested: findings before any code. **Important:** the data contradicts the "extract inline CSS" hypothesis — the homepage is **Style-&-Layout-bound, not render-blocking-bound**. And Best Practices has a hard blocker I need your help with. Details below._

---

## (a) Best Practices 92 — what it flags, and my blocker

**I cannot read the live report from this environment.** The PSI API key is quota-exhausted (all day), and sandboxed Chrome can't navigate to `https://resumetailored.com/` (the proxy throws a TLS interstitial). Local Lighthouse scores Best Practices **100**, so the failing audit only manifests against the real live site.

**What I can determine by weight arithmetic.** The scored BP audits total ~26 weight. **92% ≈ 24/26**, which matches the two console/issue audits failing together:
- `errors-in-console` (weight 1) — a JS error or blocked request logged to the console.
- `inspector-issues` (weight 1) — something in Chrome's Issues panel (often a **CSP violation**, a deprecated-API warning, or a cookie warning).

Everything else scores clean locally and in source: HTTPS ✓, no mixed content ✓, no `document.write` ✓, `noopener` ✓, doctype/charset ✓, `deprecations` ✓, `third-party-cookies` ✓ (GA's `_ga` is first-party — if *that* were failing you'd see ~80, not 92).

**Two things worth noting on live:**
1. The app's CSP (`server.js` → `security.js`) still allow-lists the **removed AdSense**: `pagead2.googlesyndication.com`, `*.googlesyndication.com`, `*.doubleclick.net`, `*.google.com` in `script-src`/`frame-src`/`connect-src`. Dead cruft now. I'll prune it regardless — it shrinks the header and removes any path where a stray doubleclick/GA sub-request trips a CSP console error.
2. GA4 (`gtag`) is the only third party left and is the most likely source of a benign console message (e.g., a blocked `td.doubleclick.net` linker ping).

**🔴 What I need from you (blocker):** open `https://resumetailored.com/` in Chrome → **DevTools ▸ Console** (copy any red errors) and **DevTools ▸ Lighthouse ▸ Best Practices** (expand `errors-in-console` and `inspector-issues` and paste what they list). That's the only way to pin the exact -8 — I can't see the live console from here. With that text I can fix it precisely; without it I can only ship the CSP cleanup and hope it covers it.

---

## (b) Performance — the top-3 bottlenecks (from a local mobile trace)

Local absolute scores are sandbox-noisy (this run: 86; live: 83), **but the main-thread category breakdown is structurally accurate** and it's unambiguous:

| Rank | Main-thread category | Cost (local) | What it is |
|---|---|---|---|
| **#1** | **Style & Layout** | **2,290 ms** | Computing styles + laying out the DOM |
| #2 | Other | 831 ms | GC, misc runtime |
| #3 | Rendering (paint) | 248 ms | Painting pixels |
| — | Parse HTML & CSS | 60 ms | — |
| — | **Script Evaluation** | **55 ms** | JS execution — *already tiny* |
| — | Render-blocking resources | **NONE** | already eliminated |

### This changes the plan. The inline-CSS extraction won't help.

Your step-1 hypothesis was "~270 KB inline CSS → extract to external." The measurements say otherwise:
- Inline **CSS is only ~35 KB** (2 `<style>` blocks). Inline **JS is ~84 KB** but its **eval is only 55 ms** (the animation-defer already handled JS). The rest is ~140 KB of **markup** (~1,772 elements).
- **There are zero render-blocking resources.** Externalizing the inline CSS would *add* a request and risk FOUC (or force a `preload/onload` dance), and it would **not reduce Style & Layout at all** — the same rules still apply to the same DOM. It could make FCP *worse*.
- The real cost is **style recalc + layout over a large DOM (~1,772 nodes, 13 sections)**. That's what 2,290 ms of "Style & Layout" means.

### The right lever: `content-visibility` on below-the-fold sections

The textbook fix for a Style-&-Layout-bound page is CSS containment: add `content-visibility: auto` (+ `contain-intrinsic-size` to reserve space) to the **~12 below-the-fold `<section>`s**. The browser then **skips style/layout/paint for offscreen sections** until you scroll near them — directly attacking the 2,290 ms — with **no content removed**.

It's safe against all your constraints:
- ✅ `test/homepage-motion-defer.js` untouched (no script changes).
- ✅ Hero LCP stays CSS-animated (containment goes on below-fold sections only, never the hero).
- ✅ Nothing is hidden from JS/a11y — `content-visibility:auto` is **not** `display:none`; content stays in the DOM, the a11y tree, and the index (so **Accessibility & SEO stay 100**).
- ⚠️ One thing to get right: `contain-intrinsic-size` estimates per section, so scrolling doesn't cause CLS. I'll set per-section estimates and keep CLS at 0.

Optional secondary wins (smaller): trim the largest inline `<script>` (the i18n content maps, ~biggest of the 84 KB) into an external cached file to cut HTML transfer/DOM-ready; and reduce node count in the heaviest decorative sections. I'd do `content-visibility` first and re-measure.

---

## Proposed plan (on a branch)

1. **Prune the dead AdSense/doubleclick allowances from the CSP** (`security.js`) — Best Practices hygiene + smaller header.
2. **Add `content-visibility:auto; contain-intrinsic-size:…` to the below-the-fold homepage sections** — the real Performance lever.
3. Re-run the local trace after each step; keep the full suite green; add a guard test.
4. Report expected lift + record the before/after in `TASK_SUMMARY.md`. You merge → PSI 3× → median → I record final.

## Questions before I code

1. **Approve the pivot?** I want to ship **`content-visibility` containment**, *not* the CSS-extraction, because the trace shows CSS extraction won't move a Style-&-Layout-bound page (and risks FCP). OK to proceed that way?
2. **Best Practices:** please paste the live **DevTools Console** output and the **`errors-in-console` / `inspector-issues`** audit details (see 🔴 above) — I can't reach the live console, and that's the only way to fix the exact -8 rather than guess. (I'll ship the CSP cleanup regardless.)
