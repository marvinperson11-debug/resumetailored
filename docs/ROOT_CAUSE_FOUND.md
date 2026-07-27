# Root cause found. Your screenshot solved it.

**All three verified in my own environment.** Committed to the branch, **not deployed** — `main` is still at `64396fc`. It goes out when you say so.

---

## 1. The bug

Your error line was the whole answer:

```
Stage: fillFromResume
Status: 200
Error: TypeError: SiteFields.fillFromResume is not a function
```

**The function was never missing.** It is in `site-fields.js`, line 221, exported on line 293. It was not deleted in the cleanup and it was wired up correctly.

**Your browser was running an old copy of that file.**

```
app.html         Cache-Control: no-cache        → always fresh
site-fields.js   Cache-Control: max-age=86400   → cached for a day
```

When the picker change shipped — new `app.html` that *calls* `fillFromResume`, new `site-fields.js` that *defines* it — any browser that had visited in the previous 24 hours took the new HTML and kept the old module. Reloading does not help: `max-age` means the browser does not even ask the server.

That also explains the symptoms exactly:

| what you saw | why |
|---|---|
| Fails every time, first click, fresh load | The cached module is used on every load until it expires |
| Preview works fine | Preview never calls `fillFromResume` |
| Page goes completely blank | The throw killed the handler mid-swap, after the old view was torn down and before the new one was built |
| I could never reproduce it | **My harness launches a clean browser with an empty cache every run**, so it always had both halves |

That last row is the important one. My test setup was *structurally incapable* of finding this bug. Reporting "works locally" was never going to mean anything for this class of failure, and I should have understood that after the first time you told me it was broken.

---

## 2. The three fixes

**1. The coupled modules stop going stale.** `site-fields`, `site-vibes` and `site-doc-store` are versioned together with the HTML that calls them, so they are now served `no-cache` — which still revalidates and returns 304 when unchanged; it is not "never cache". Their script tags also carry `?v=2`, so a browser holding a stale copy is asking for a different URL and must refetch. **This is the actual fix.**

**2. The call is checked, not assumed.** Filling is an *improvement* to a template, not a precondition for using it. If the function is unavailable the template is applied unfilled and you are told to reload, instead of the handler dying.

**3. A failure can no longer blank the page.** The catch now puts you back in your editor if you have a site, or the gallery if you do not. Losing the action is acceptable; losing the screen is not.

Plus the sidebar fix: `body.wb-picker` hid the app sidebar without moving `.cv-shell` off its 240px offset.

---

## 3. Verified here, at 1440px, from your actual state

Not a fresh database this time — an **existing published site**, so the swap path rather than the create path my earlier harness used.

| check | result |
|---|---|
| **Template switching** | `executive → studio`, new site created, editor opens on it |
| **Stale module** (simulated by deleting the function — your exact error) | Page **not blank**: 61 visible elements, 555 characters of text. Template still applied. Toast: *"Applied, but your details could not be filled in. Reload the page to fix this."* |
| **Sidebar collapse** | Blank strip **0px**, shell width 1440 = full viewport |

630 assertions green.

---

## 4. What I got wrong, and what changes

Two rounds ago I told you the rate limit was the likely cause. You told me it was not — first click, fresh load — and you were right. I then shipped a diagnostic build instead of asking myself the more useful question: *what could differ between a real browser and a headless one?* Cache is close to the top of that list.

**What changes:** a clean-cache test proves a feature works for a new visitor. It says nothing about a returning one. Any change that adds a call from `app.html` into one of those shared modules needs the `?v=` bumped, and that is now written next to the script tags so the next person hits it.

---

## 5. One question

**Do you want this deployed now?**

I have not, because you said to confirm locally first and I would rather you say go. Two things worth knowing when you test:

- **You may need one hard reload.** Your browser is still holding the stale `site-fields.js` from the last deploy. The `?v=2` should defeat that on its own, but if the very first load looks odd, a force-reload will settle it — and after this deploy the problem cannot recur.
- **Your existing site's content is still untouched.** Nothing here rewrites saved sites.
