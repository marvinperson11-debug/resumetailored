# TASK_SUMMARY — Fix the two exact console errors (BP 92→100, Perf font-preload waste)

Date: 2026-08-09. Branch: `claude/markdown-file-response-y8qolt`.

You captured the exact live errors from DevTools; both are fixed here with their root causes confirmed locally.

## Fix 1 — Best Practices: unblock the Cloudflare Insights beacon (CSP)

**Error:** `Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/…' violates … script-src …` — the browser blocks it and logs a console error → fails `errors-in-console` + `inspector-issues`.

**Root cause:** the Cloudflare **Web Analytics beacon is injected at the edge by Cloudflare itself** — it is *not* in our HTML (grep-verified: zero references in `public/`). Our app-set CSP (`security.js`) didn't allow it, so Cloudflare's own injected script was CSP-blocked on every page.

**Fix (`security.js` `buildCSP`):**
- `script-src` += `https://static.cloudflareinsights.com` (the beacon script)
- `connect-src` += `https://cloudflareinsights.com` (the beacon POSTs RUM data there — allowing the script but not its beacon would just move the error)

(Alternative you could take instead: turn off Web Analytics in the Cloudflare dashboard. I allow-listed it since it's a first-party CF feature and presumably wanted.)

## Fix 2 — Performance: font preload/URL mismatch (the "preloaded but not used" warnings)

**Error:** 4× `The resource …/fonts/inter-normal-latin.woff2 was preloaded using link preload but not used within a few seconds…` (Inter + Fraunces).

**Root cause (confirmed on the served HTML):** the preload href carried a cache-busting query — `/fonts/inter-normal-latin.woff2?v=<build>` — but `fonts.css`'s `@font-face src` references the **un-versioned** URL `/fonts/inter-normal-latin.woff2`. The browser treats those as **different resources**: it fetched the `?v=` preload, never matched it to the font, warned, and then **downloaded the woff2 a second time** for the actual `@font-face`. So the preload was pure waste (and double bytes).

**Fix (`server.js` `_SELF_FONT_LINK`):** dropped the `?v=` from the two font preload hrefs so they match `fonts.css` byte-for-byte. The woff2 are content-stable and already `max-age=2592000` (30d), so they don't need busting. Now: one download, preload actually used, no warning.
- `as="font"` + `type="font/woff2"` + `crossorigin` were already correct and match the CORS `@font-face` fetch.
- Above-the-fold usage confirmed: the hero heading uses Fraunces, body/nav use Inter — both preloads are used.

## Also verified: all fonts are truly self-hosted

You saw a gstatic `@font-face` in the Elements tab. On the **current served homepage** there is **zero** `gstatic`/`googleapis` reference — the `_selfHostFonts` rewrite strips the Google Fonts link + preconnects at serve time, and `fonts.css` references only local `/fonts/*.woff2` (grep-verified). That gstatic view was a pre-#364 deploy or a cached page. (The only place Google Fonts still legitimately loads is `app.html`'s signature-font picker — Dancing Script/Great Vibes/Satisfy/Caveat — which is behind login and intentionally kept on the CDN.)

## Tests

- `test/security.js` — updated: CSP must now include `static.cloudflareinsights.com` + `cloudflareinsights.com` (and still must NOT include the pruned AdSense hosts).
- `test/font-selfhost.js` — added a guard: the font preload href must carry **no** `?v=` (must match the `fonts.css` src), so this mismatch can't regress.
- Full suite: **37 files green.**

## Expected

- **Best Practices → 100** (the blocked CF beacon was the console error).
- **Performance back to 88+** (removes 4 preload warnings + a duplicate woff2 download; content-visibility gains from #364 remain).

CI expected green — merge → deploy → re-run PSI Mobile and send Performance + Best Practices; I'll record the final before/after here.
