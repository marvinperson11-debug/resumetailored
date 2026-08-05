# Why the mobile fixes "weren't showing up" — root cause found

You were right that something was systemically wrong — three merged PRs (#320, #321, #322, #323) all shipped real, correct fixes that then visibly did nothing. I found why, and it's not any of the four bugs individually — it's one shared infrastructure bug underneath all of them.

## Root cause: CSS/JS were cached for 24 hours; the fixes live in CSS/JS

`server.js`'s static file server was sending:
- HTML: `Cache-Control: no-cache` (always revalidates — this is why new page markup shows up instantly)
- **CSS and JS: `Cache-Control: public, max-age=86400`** (cached for a full day, no revalidation at all until it expires)

Every one of the four bugs you reported lives in a CSS or JS file:

| Bug | File | Status on disk (verified) |
|---|---|---|
| Faded headings/titles | `public/theme.css` | The Round 3 dark-text rule is present and correct |
| Bottom tab bar clipping | `public/style.css` | The Round 2/3 fix (62px bar, hidden badges) is present and correct |
| Optimization Hub title not centered | `public/theme.css` + `public/score.html` | `.hero{text-align:center}` was always correct — this was the contrast bug in disguise (see below) |
| Skills Lab profession switcher needs refresh | `public/career-hub.js` | The fix ("capture the callback before closePicker nulls it") has been on `main` since PR #320 |

**All four fixes are real and already in the code.** Your browser (and anyone else's) just kept using its own locally-cached copy of `theme.css` / `style.css` / `career-hub.js` from before any of these fixes shipped — for up to 24 hours from whenever it was first fetched, with zero server contact in between, invisible to the deploy log, invisible to you unless you did a hard-refresh (clearing the cache) at exactly the right moment. Testing "live" right after each merge — the natural thing to do — is *exactly* the scenario most likely to still be inside that 24-hour window from an earlier visit that predates the fix.

I confirmed this isn't a guess: this exact caching pattern already caused one prior incident in this codebase (`SiteFields.fillFromResume is not a function`, documented in a comment right next to the code I changed) — the fix at the time only special-cased the two or three files known to be involved, rather than the general problem. This time every CSS/JS file gets the same `no-cache` treatment HTML already had. `no-cache` still lets the browser skip a full re-download when nothing changed (a cheap 304 via ETag) — it just means "always ask first," so a genuine fix is visible on the very next page load instead of up to a day later.

Verified server-side after the fix (local run):
```
theme.css:      Cache-Control: no-cache
style.css:      Cache-Control: no-cache
career-hub.js:  Cache-Control: no-cache
favicon.png:    Cache-Control: public, max-age=2592000   ← unchanged, images/fonts aren't part of this bug
```

**What to do on your end once this deploys:** a hard-refresh (or private/incognito window) to bypass whatever's still in your phone browser's cache from today, then it should self-correct for everyone else without any action.

## A second, real bug found along the way: rate-limit errors were swallowed

Separately from caching, I found a genuine bug that explains the blunt **"Search failed."** message in your Job Finder screenshot: the site-wide rate limiter (30 requests/minute per IP, shared across every `/api/...` call) sent back `{"error": "Too many requests, please slow down."}` — note there's no `message` field, only `error`. Every frontend call site reads `res.data.message || <generic fallback>`, so hitting this limiter anywhere in the app silently showed a useless generic message instead of the real "you're doing this too fast, wait a minute" — for Job Finder specifically that's `"Search failed."` I found and fixed the same shape bug on 4 other rate limiters that had it. Now every one of them returns a real, readable `message`.

I can't tell you from here whether the rate limiter is what triggered your specific screenshot, or whether it's `RAPIDAPI_KEY`/JSearch's monthly quota (fixed separately in #325, merged before this) — those are two different possible causes and both now produce an honest message instead of a dead end. **Check `https://resumetailored.com/api/health` after this deploys** — if `rapidapi: false`, JSearch was never configured and that's a Railway env var to set, not a code bug.

## Files changed
`server.js` (Cache-Control policy + 5 rate-limiter message shapes), `test/static-asset-caching.js` (new — regression guard for both).

## Open question I can't answer from here
I don't have confirmed access to Railway's dashboard or logs this session (that tool call was interrupted earlier), so I can't personally rule out an additional CDN layer in front of Railway also caching at its edge. If a hard-refresh still doesn't show the fixes once this deploys, that's the next thing to check — but the browser-cache root cause above is well-evidenced enough (matches all four symptoms, matches a prior documented incident, and the "fixed" code is provably already correct on disk) that I'm confident this is the real fix, not a guess.
