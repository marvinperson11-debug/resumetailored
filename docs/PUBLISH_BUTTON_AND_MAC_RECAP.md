# The Publish button, and a recap of the Mac sidebar fix

**Live-verified in a real browser, not just a static check. Full suite green.**

---

## 1. Why "Publish website" looked like it wasn't working

It was running — it just never told you. `wcPublish()` writes everything it has to say (`Publishing…`, the success message with your live URL, or an error like "choose an address first") into one element: `#wcPublishStatus`.

That element lives inside the **"Content" rail pane** — one of six tabs on the left (Templates, Elements, Text, Brand, Uploads, Content), hidden with `display:none` unless that specific tab is open. The Publish button, meanwhile, sits in the **top toolbar**, always visible, completely independent of which rail tab you're on. Templates is the tab you land on by default and the one you're naturally looking at while building — not Content. So the overwhelmingly common case was: click Publish, the request goes out, it succeeds or fails for a perfectly real reason, and the only place that gets said is an element with zero width and zero height on your screen.

I confirmed this live rather than just reading the code: opened the editor, checked `#wcPublishStatus`'s actual on-screen size while the default Templates tab was showing (0×0, genuinely invisible), clicked Publish, and watched a toast appear with the real result — `🌐 Live at http://.../site/... — link copied`.

**Fixed by toasting the same message the status panel already gets.** Toasts are the one feedback surface every other action in this editor already uses (uploads, deletes, autosave) — it's shown regardless of which tab is open. The Content panel still gets its own note too, for anyone who does have it open.

**A second, smaller bug in the same function:** the code that disables the button while a publish is in flight was looking for an element with `id="wcPublishBtn"` — an id that didn't exist anywhere on the page. The lookup was guarded (`if (btn) ...`), so it didn't throw, but it silently meant the button was never actually disabled during a publish, and a double-click could fire two publish requests. Fixed by giving the real button that id.

## 2. The Mac sidebar/toolbar — recap

This was fixed and merged already, in the round before this one (PR #304, now on `main`). Recapping what was actually wrong, since you asked:

The editor's top toolbar (Save/Undo/Redo/Pages on the left, Preview/Publish on the right) had **zero margin by design** — the only flexible element in that row was an empty spacer, so the row was always packed edge-to-edge with no slack. That's fine as long as every browser measures button text identically, and they don't: Safari renders macOS's system font at different metrics than Chromium does. I couldn't reproduce it directly (no Safari/macOS available here, and Chromium on Linux showed the toolbar comfortably fitting all the way down to 1024px wide), but a few extra pixels from font rendering alone was enough to tip it into one of two failures on your machine — the whole toolbar cluster pushed past the edge with nothing to scroll it back into view, or individual buttons squeezed their own text into a wrapped, crushed mess ("half the sidebar is cut off" is exactly what that looks like).

**Fixed by removing the zero-margin design entirely**: every real toolbar button now refuses to shrink (`flex-shrink: 0`), and the row itself wraps to a second line instead of clipping if it ever doesn't fit (`flex-wrap: wrap`, previously only true below 820px for phones — now true everywhere). I proved the fix mechanically since I couldn't reproduce the original on this machine: forced the same kind of extra width a different font's metrics would add, and confirmed the row wraps cleanly to two lines with every button fully visible, no clipping, no squeezed text, at both 1280px and 1440px. That check is permanent now, in `test/browser/editor.js`.

---

## Test results

```
test/*.js (15 files, dependency-free)     ALL PASS, 0 failures
test/browser/editor.js                    272/272
Live verification (this round)            #wcPublishStatus confirmed 0×0 on the default
                                           tab; toast confirmed visible with the real
                                           publish result
```

## What changed this round

- `public/app.html` — `wcPublish()`'s `setStatus` helper now also calls `showToast(msg, ...)` for every message it sets (validation errors, "Publishing…", success with the live URL, failure); the actual toolbar Publish button gained `id="wcPublishBtn"` so the existing disable-while-publishing logic has something real to disable.
- `test/site-publish.js` — three new checks: the button carries the id `wcPublish()` looks for, every status message reaches a toast, and a check pinning down exactly where the bug lived (`#wcPublishStatus` inside the `display:none` Content pane) so this can't quietly regress.
