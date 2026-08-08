# TASK_SUMMARY — Homepage Accessibility → 100 (+ status of the other categories)

Date: 2026-08-08. Branch: `claude/markdown-file-response-y8qolt`.

Targets the PageSpeed gaps on the mobile homepage after the AdSense removal moved Performance 43 → 82. Since I can't run field PSI from this environment (undeployed branch; PSI API key quota-exhausted; sandboxed Chrome can't reach external URLs), I ran **Lighthouse — the same engine PSI uses — locally against the booted server**. Lighthouse's **Accessibility, Best Practices, and SEO** audits are computed from the rendered DOM, so they're reliable locally; only the Performance *absolute score* is network-noisy here.

## Before / after (Lighthouse mobile, homepage `/`)

| Category | Before (your PSI) | After |
|---|---|---|
| Accessibility | 93 | **100** ✅ verified locally |
| Best Practices | 92 | **100** locally — see note |
| SEO | 100 | **100** ✅ |
| Performance | 82 | see note — **not shipped to 100 blind** |

## Accessibility 93 → 100 (this PR)

Lighthouse flagged exactly two audits; both fixed on `index.html` and `zh/index.html`:

1. **`color-contrast`** — three elements in the footer "Accepted Payments" row failed AA (4.5:1):
   - label text `#6b7280` on the cream footer (`#f1eadd`) → 4.04 → changed to **`#57514A`** (6.55).
   - Alipay badge, white on `#1677ff` → 4.10 → **`#0b5ed7`** (5.84).
   - WeChat badge, white on `#09bb07` → 2.58 → **`#1b7a1a`** (5.46).
2. **`landmark-one-main`** — the page had no `<main>`. Wrapped the content between the nav and the footer in a single `<main id="main-content">`.

Re-ran Lighthouse: **Accessibility 100, 0 remaining failures.** `test/homepage-a11y.js` locks it in (one `<main>`, and the WCAG contrast formula applied to the payment row).

## Best Practices 92 → (expected 100)

Lighthouse scores Best Practices **100 locally**, and the deterministic BP checks are clean in source: **no mixed content** (no `http://` resources), **no `target="_blank"` without `rel="noopener"`**. The live 92 was almost certainly **AdSense** (third-party cookies / console warnings), which the previous PR removed. It should read 100 on production once this deploys — confirm with a live run.

## Performance 82 → not shipped blind (needs your call)

I did **not** push a Performance change in this PR, because the remaining lever is a **UX tradeoff I won't make unilaterally**. Lighthouse's performance opportunities are otherwise clean — `unused-javascript` ✓, `unused-css-rules` ✓, `unminified-*` ✓, `bootup-time` 0.3 s ✓, no render-blocking flagged. The one remaining main-thread cost is the **scroll-animation stack**: `vendor/gsap.min.js`, `vendor/ScrollTrigger.min.js`, `vendor/lenis.min.js`, `site-motion.js`. They're already `defer`red, but they still execute on load to power the entrance/scroll animations and Lenis smooth-scroll.

**Option to reach ~100:** delay that animation stack until first interaction (same pattern as GA), so it's off the initial main thread. **Tradeoff:** entrance animations and smooth-scroll wouldn't initialize until the user first scrolls/touches — a visible change to the site's polish on first paint. Reversible. **Tell me to proceed and I'll ship it**; otherwise 82 (likely higher post-deploy once fonts + AdSense removal are fully reflected in the field) is a strong result without touching the design.

## Scope note

These fixes are on the two homepages (the page you measured). The footer + missing-`<main>` pattern is shared, so other page types likely show the same two audits; a **site-wide accessibility pass** (apply `<main>` + the contrast fix across the ~355 static pages, ideally via the server-side rewrite mechanism already used for fonts) is a clean follow-up if you want every page at 100 — say the word.

## Tests

`test/homepage-a11y.js` (new) guards the landmark + contrast fixes. Full suite: **34 files green.**
