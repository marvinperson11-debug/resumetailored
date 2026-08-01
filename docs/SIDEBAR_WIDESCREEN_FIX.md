# Sidebar cut off on Mac, correct on Windows — fixed

## Why the two screenshots looked so different

Your Windows screenshot and Mac screenshot weren't showing the same bug in two states — they were showing two *different* bugs that both live in the same CSS rule.

Last round I fixed the case where the app sidebar and the Website Creator's editor shell (`.cv-shell`) disagreed about where the sidebar's collapse breakpoint was (981px vs 900px), which caused overlap in a narrow 901-980px window. That fix is still correct and still live.

This report is a **different bug**, only visible on a **wide screen** (a Mac external display, or any window wider than 1600px). I reproduced it with a headless-browser script that measures the real on-screen geometry rather than guessing from the CSS source:

```
=== 1920px (before the fix) ===
  .dashboard: {"x":160,"right":1760}   ← the app's dashboard is CENTERED
  .sidebar:   {"x":160,"right":400}    ← so the sidebar sits at x=160..400
  .cv-shell left: 240                  ← but the shell only moved to x=240
  *** MISALIGNED: shell starts at 240 but sidebar ends at 400 ***
```

## Root cause

`public/style.css` centers the whole dashboard on wide screens:

```css
.dashboard { grid-template-columns: 240px 1fr; max-width: 1600px; margin: 0 auto; }
```

Past 1600px of browser width, that `margin: 0 auto` adds equal blank space on both sides, so the sidebar's real left edge shifts right by `(viewport width − 1600) / 2`. At 1920px wide, the sidebar isn't at x=0..240 anymore — it's at x=160..400.

The Website Creator's full-screen editor shell (`.cv-shell`) didn't know that. It used a flat `left: 240px`, which assumed the sidebar always starts at x=0. On a wide screen, the shell's own solid dark background then painted itself **over the last 64–240px of the real sidebar** — covering the FREE/PRO badges and the tail of every label. That's exactly what your Mac photo shows: labels that look truncated ("Resu…", "Link…") aren't actually cut in the HTML — they're hidden behind the editor shell's own background, and the "blank gray gap" before the template gallery is that same shell background showing through before the (separately centered) gallery content starts.

Windows rendered correctly only because the window width you tested it at happened to be under 1600px, where the flat 240px value is still correct by coincidence.

## Fix

Changed the shell's offset to mirror the dashboard's own centering math instead of a fixed number:

```css
/* public/app.html */
@media (min-width: 901px) {
  .cv-shell { left: max(240px, calc((100vw - 1600px) / 2 + 240px)); }
}
```

Below 1600px this evaluates to `240px` (unchanged). Above it, it grows exactly in step with how far `.dashboard` has shifted the sidebar right.

## Verification (live geometry, not source-reading)

| Width | Sidebar position (before) | Shell offset (before) | Result (before) | Shell offset (after) | Result (after) |
|---|---|---|---|---|---|
| 1280–1600px | x=0..240 | 240px | ✅ aligned | 240px | ✅ aligned |
| 1728px | x=64..304 | 240px | ❌ 64px of sidebar hidden | 304px | ✅ aligned |
| 1920px | x=160..400 | 240px | ❌ 160px of sidebar hidden | 400px | ✅ aligned |
| 2560px | x=480..720 | 240px | ❌ 240px of sidebar hidden | 720px | ✅ aligned |

`test/browser/sidebar-breakpoint.js` (real Chromium, real `getBoundingClientRect()` measurements) now covers both the original narrow-window case and this wide-screen case — 12 widths from 880px to 2560px, all passing. Full test suite (`test/*.js`) still 0 failures.

## What's next

Pushing this to `claude/resumetailored-pricing-plan-iwy6un` and opening a draft PR against `main`. I'll watch it through CI and merge once the deploy preview is green — let me know if you'd like anything else looked at first.
