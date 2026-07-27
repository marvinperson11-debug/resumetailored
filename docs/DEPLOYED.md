# Deployed. Four fixes — including the device toggle.

`main` is at **`0762bdc`** (PR #280). Railway is building it. **630 assertions green.**

---

## 1. The device toggle — you asked; I found it before deploying

You were right that it could not be cache: those buttons live in `app.html`, which is served `no-cache`. It is a different bug entirely, and it is a one-line class-name mismatch.

The buttons are styled by `.is-on`:

```css
.cv-segbtn.is-on { background: #fff; color: #4338ca; }
```

But `edSetDevice` was toggling **`wc-vtab-active`** — a class copied from the template gallery's device tabs, which are a *different control with different CSS*. So `is-on` stayed stuck on Desktop forever and the highlight never moved.

**The canvas was switching the whole time.** `edDevice` changed, the stage refit, the preview really did become 390px wide. Nothing on screen ever confirmed it, which is indistinguishable from a dead button.

That is also exactly why my earlier test reported it working: **I measured `edDevice`, the variable, instead of what you can see.** Same mistake as checking a `hidden` property while the element was still on screen. Measuring state is not measuring the interface, and I have now made that error twice.

Verified on rendered background colour, not on a variable:

```
Desktop  rgb(255,255,255) → rgba(0,0,0,0)
Mobile   rgba(0,0,0,0)    → rgb(255,255,255)
```

---

## 2. Everything in this deploy

| | |
|---|---|
| **Template switching** | Coupled modules no longer go stale — `no-cache` (still revalidates, still 304s) plus `?v=2` on the script tags |
| **Blank page** | The call is checked, not assumed; a failure returns you to your editor or the gallery |
| **Device toggle** | Toggles the class the CSS actually styles |
| **Blank strip** | `body.wb-picker` now moves `.cv-shell` off its 240px sidebar offset, as `body.cv-wide` already did |

Verified at 1440px from your state — an existing published site, so the swap path:

- `executive → studio`, site created, editor opens
- Stale module simulated: page **not blank** (61 elements, 555 chars), template applied, toast explains
- Device toggle: highlight moves both ways
- Sidebar: blank strip **0px**, shell fills all 1440

---

## 3. When you test

**Hard-reload once.** Your browser still holds the old `site-fields.js`. The `?v=2` should defeat that by itself, but if the first load looks odd, a force-reload settles it — and after this deploy the problem cannot recur, because those modules now revalidate on every load.

Worth checking, roughly in order:

1. **Use** on a template with your existing site → applies, editor opens, no blank page
2. **🖥 / 📱** → the highlight moves *and* the canvas changes width
3. The picker → no blank strip on the left
4. Publish → open your live address

---

## 4. What I want to say about this round

You found this bug, not me. The `Stage:` line from the toast identified it in one screenshot after I had spent two rounds guessing — first at a rate limit you had already ruled out, then at a diagnostic build that only paid off because you ran it.

The pattern in my mistakes is consistent and worth naming: **I kept verifying internal state instead of what a user sees.** `edDevice` changed, so I called the toggle working. The `hidden` property was set, so I called the button hidden. The clean-cache harness passed, so I called template switching fixed. All three were true statements about variables and false statements about your screen.

The tests I added this round measure rendered colour, measured geometry, and simulated failure modes. That is the change that should stop this repeating.

---

## 5. Still outstanding

Not touched, and not forgotten:

- **Deleting the simple-mode code.** Unrouted and unreachable, still on disk. That is the boring second PR once you are happy with the editor — with the small verified passes and the size gate, after the attempt that cut 7,935 lines.
- **Your existing site's content.** Nothing here rewrites saved sites. If it still shows the wrong template or someone else's name, picking a template again builds the one you choose as a new site.

If the device toggle still does nothing after this deploy, tell me and I will treat it as a fresh investigation rather than assuming this fix covered it.
