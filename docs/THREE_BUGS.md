# Three bugs: one found and fixed, one rebuilt, and one I could not reproduce

Pushed to `claude/resumetailored-pricing-plan-iwy6un`. **630 assertions green.** Verified in a browser at **390px and 1440px**. PR next — read §2 first, because I want you to know what I am less sure about.

---

## Bug 3 — Picker as the front door ✅

This one was straightforward and is done exactly as specified.

Every entry point — dashboard, nav, Tailor tab — now opens the **template gallery first**: full screen, grid only. Measured with everything else confirmed hidden:

| hidden in the gallery | |
|---|---|
| app sidebar | ✅ |
| editor top bar | ✅ |
| rail | ✅ |
| canvas | ✅ |
| inspector | ✅ |
| zoom bar | ✅ |
| **template tiles shown** | **12** |

Tapping **Use** builds the site from that template and opens the editor on it — confirmed at both widths: `picker → editor`, `templateId: executive`, site created.

**"Edit my current site"** sits above the grid, shown only when a site exists. Every tile builds something *new*, so without it the gallery would stand between you and the site you already have.

One deliberate exception: Back Office → **Edit this site** still goes straight to the editor. You named a specific site there, so making you choose again would ignore what you pressed.

---

## Bug 1 — Template switching ⚠️ found a real cause, but could not reproduce your error

**What I found and fixed:** `/api/site-templates/:id` — the request that **Use** makes — was **not exempt from the shared 30/min rate limit**, while the twelve template preview iframes *were*.

So: opening the editor spends a chunk of that budget, and every **Use** tap spends another. Switch template a few times, reload once or twice, and the route returns **429**. The client cannot tell 429 from anything else and says exactly what you saw: *"Could not load that template."*

The template document is static content read off a module — identical in cost to the preview sitting next to it — so it now shares the same generous budget.

**Why I am only ⚠️ and not ✅:** I could not reproduce your error locally. I tried at 390px and 1440px, and with your exact situation recreated — a published site whose stored config is the raw Executive template. **Use** worked every time: `executive → minimal`, toast *"✓ Template applied"*.

The rate limit is the one mechanism that would fail on the deployed site while passing in my harness, because **my harness runs with the limiter disabled**. That fits your symptom precisely. But I am inferring, not demonstrating.

---

## Bug 2 — Device toggle ⚠️ could not reproduce at all

I tapped both buttons at both widths, before and after the fix:

```
desktop   mobile-> mobile   desktop-> desktop
phone     mobile-> mobile   desktop-> desktop
```

`edDevice` changes, the active class moves, and the canvas resizes (1126px desktop → 334px in mobile view on a phone). No JavaScript errors.

I have **not** knowingly fixed this. It may have been collateral from Bug 1 — if the page had already thrown, later handlers can stop responding — or it may be something my harness does not recreate.

---

## What I need from you

Please retest on the deployed site once this merges, and if either is still wrong:

1. **Does it fail every time, or only after you have been clicking around for a while?** If it starts working after a minute's pause, that confirms the rate limit and the fix lands it.
2. **For the device toggle — does anything else on the page still respond?** If Publish and the rail have also gone dead, the page has thrown and the toggle is a symptom, not the cause.
3. **Anything in the browser console**, if you can reach it. One error message would save a lot of guessing.

---

## An honest note on this round

I fixed a real bug that plausibly explains Bug 1, and I rebuilt Bug 3 to spec. But I want to be straight that I shipped a fix for a failure I never saw fail, and no fix at all for Bug 2 beyond confirming it works in my hands.

That is worth saying plainly rather than reporting "3 of 3 fixed."
