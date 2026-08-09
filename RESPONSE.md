# Homepage UI bug fixes

All three reported UI/UX bugs are fixed, verified in a real headless Chromium at
1366×768 and 1920×1080, and the full test suite is green (**39/39**).

## What was wrong and what I changed

This is a **static HTML site** (no Next.js). The homepage (`public/index.html`)
ships its own hardcoded nav, while every other marketing/SEO/blog page has its
nav injected by `public/site-nav.js`. That split is the root of bugs 2 and 3.

### BUG 1 — Hero CTA below the fold on desktop
`public/index.html` (CSS)

The hero stacked `padding-top: 100px` + a `clamp(…, 76px)` headline + wide
margins, pushing the primary CTA past 768px.

- `.hero` top padding `100px → 48px`
- `.hero h1` `clamp(42px, 6.4vw, 76px) → clamp(40px, 5.4vw, 62px)`,
  line-height `1.06 → 1.05`, margin-bottom `24px → 18px`
- `.hero-sub` margin-bottom `34px → 22px`, line-height `1.72 → 1.6`

**Measured result (real browser, full viewport):**

| Viewport | CTA row bottom | Fold | Above fold? |
|---|---|---|---|
| 1366×768 | 490px | 768px | ✅ 278px to spare |
| 1920×1080 | 490px | 1080px | ✅ 590px to spare |

Comfortably clears the fold even after real browser chrome (~130px) is
subtracted from a physical 768px laptop screen.

### BUG 2 — 中文 toggle jumped position between pages
`public/index.html` (nav markup + CSS)

On the homepage the toggle was floated **after** the CTA (far right); on
site-nav pages it sits **before** Log In. Same button, two positions.

Fix: locked the homepage nav to the exact canonical order used by
`site-nav.js` — `[中文] [Log In] [CTA]`, all inside the one right-aligned
`.nav-actions` group. Added a separate `.nav-mobile-actions` group (中文 +
hamburger) so mobile parity is preserved. No conditional rendering moves the
toggle any more.

**Measured result** — `中文` is now left-of-Login and right-aligned on both `/`
and `/resume-examples`, at matching coordinates.

### BUG 3 — Full-page white flash between tabs
`public/index.html` (inline CSS) + `public/site-nav.js` (injected CSS)

Static MPA, so I used the **cross-document View Transitions API**:

```css
@view-transition { navigation: auto; }
@media (prefers-reduced-motion: reduce) { @view-transition { navigation: none; } }
```

Chromium (the browser in the screenshots) now cross-fades between full page
loads instead of hard-flashing; other browsers ignore the rule and behave as
before; reduced-motion users get no animation. The rule is declared on **both
ends** of every navigation — inline on the homepage and injected by
`site-nav.js` on every other route — which is what a same-origin MPA transition
requires. Verified present in the CSSOM on both page types.

## Tests
- Added `test/homepage-ui-bugs.js` — 13 source-level guards locking all three fixes.
- Full suite: **39/39 pass** (`for f in test/*.js; do node $f; done`).
- Browser geometry verified out-of-band with the pre-installed Chromium.

## Shipping
Changes are committed to `claude/fix-homepage-ui-bugs-nac5xn` and pushed; a pull
request into `main` is open. Railway auto-deploys on merge to `main`.
