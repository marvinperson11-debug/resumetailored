# Merged and deploying. Here is what to look at on your phone.

`main` is at **`754969e`** (PR #278). Railway builds from `main`, so it is on its way. **625 assertions green. No deletions.**

---

## 1. Your three items

| You asked for | Status |
|---|---|
| Branch deployed to Railway so you can test on your phone | ✅ merged to `main` — Railway deploys from there |
| Collapse arrow back on the rail, moved so it does not overlap "Uploads" | ✅ **and it was overlapping on desktop too** — see §2 |
| Device toggle visible on phone at 390px | ✅ confirmed by measurement, on screen with Publish still reachable |

**No deletions.** Simple mode is unrouted and unreachable, and every line of it is still on disk exactly as you asked.

---

## 2. The collapse arrow was worse than you thought

You reported it overlapping "Uploads" on your phone. When I measured it, **it was overlapping on desktop as well** — it was pinned to `top: 50%` of the rail, which lands on the Uploads button at any width. It was never a mobile-only bug.

That also means my earlier "fix" was wrong twice over: I hid it at phone width, which removed a control you had asked for in order to work around a position problem that existed everywhere.

It is anchored to the bottom of the rail now, clear of the last item and above the zoom bar, with a phone position of its own beside the 56px rail.

Measured at both widths: on screen, hit-testing to itself, overlapping nothing.

---

## 3. What to click through

Worth a minute each, roughly in order of how likely I think they are to be wrong:

1. **The top bar at 390px.** Preview and Publish were completely off the right edge before — you could not publish at all. They should both be reachable now. The bar wraps to two rows to manage it.
2. **The device toggle.** Tap 🖥 — the canvas should switch to the desktop view of your site. This is the thing you cannot otherwise check from a phone.
3. **Panels.** Tap Templates, then Elements, then Text. One should open at a time, floating over the canvas rather than squeezing it. The same rail button that opened one should close it.
4. **The collapse arrow**, bottom-left of the rail. It should hide the panel and give the canvas the full width.
5. **Template tiles.** Every **Preview** and **Use** button used to be clipped off the right edge of its tile. All twelve should be fully tappable.
6. **Publish**, then open your live address, and check the page is what the canvas showed.

---

## 4. Two things I expect you may still find

Being upfront rather than letting you discover them:

**Your existing site content is untouched.** If it still shows the wrong template or someone else's name, that is stored data from before the earlier fixes — nothing in this PR rewrites saved sites. Picking a template again will build the one you choose as a new site, with the old one still in Back Office to delete.

**The canvas is a 1200px design surface** scaled into a phone screen. Precise dragging will be fiddly. I have not tried to solve that here — tell me if it is bad enough to matter and it becomes its own piece of work.

---

## 5. What happens next

1. You test and tell me what is wrong.
2. I fix whatever you find.
3. Once you are happy, **the deletion as a second, boring PR** — small verified passes, exact-text matches, and a hard size gate at ~2,500 lines after the last attempt cut 7,935.

Nothing new gets built until then.
