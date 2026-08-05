# Hub title centering + profession switcher — found the real cause, fixed it for real this time

You were right to push back on the previous "it's just caching, wait for it to expire" answer. I went and actually proved it instead of reasoning about it — booted the app locally, drove a real headless Chromium browser against the exact current code (Playwright), and found the real, remaining cause. Full details below; TL;DR at the end.

## What I found

**Both bugs are 100% fixed in the code and have been since before this conversation started.** I proved this two ways:

1. **Screenshot proof.** I rendered `/score` at a real 390px mobile width against a completely fresh (uncached) load of the current code. [See the actual screenshot in this session — the title "Resume Optimization Hub" renders solid dark and dead-center.]
2. **End-to-end flow proof.** I scripted a real browser: sign up, set profession to "Registered Nurse," open Skills Lab, click Change, search "Software Engineer," select it, save — **with no page reload at any point**. The header, category, and quiz title (*"Software Engineer Skills Test"*) all updated correctly, immediately, in the same page load.

So why were you still seeing the old broken versions? **Because the previous cache fix (PR #326) didn't actually work in production** — and I can prove that too:

```
$ curl -sI https://resumetailored.com/theme.css
cache-control: max-age=14400
server: cloudflare
cf-cache-status: MISS
```

My server sends `Cache-Control: no-cache`. **Cloudflare — the CDN sitting in front of Railway — is silently rewriting that to `max-age=14400` (4 hours) before it ever reaches your browser.** This happens specifically for `.css`/`.js` files; I checked the same thing for the HTML pages themselves and Cloudflare correctly leaves `no-cache` alone there — it's a static-asset-specific override (almost certainly Cloudflare's "Browser Cache TTL" zone setting, which by default overrides whatever the origin sends unless it's explicitly set to "Respect Existing Headers"). That's a Cloudflare dashboard setting, not something my server's headers can control — which is exactly why setting the header correctly in PR #326 changed nothing you could see.

## The actual fix: version the asset URLs, so no cache setting anywhere can matter

Instead of depending on Cloudflare (or your browser, or any future CDN) to honor a Cache-Control header — which is now *proven* unreliable here — every HTML page now references its CSS/JS with a version stamp appended, e.g.:

```html
<link rel="stylesheet" href="/theme.css?v=a1b2c3d4e5"/>
<script src="/career-hub.js?v=a1b2c3d4e5"></script>
```

The version changes on every deploy (it's the Railway git commit SHA, or a boot timestamp as a fallback). A version bump means the URL itself is different — which means it's **structurally impossible** for any cache, anywhere, to serve a stale copy: there's no old cached entry for a URL that's never existed before. This works regardless of what Cloudflare's Browser Cache TTL is set to, so it doesn't depend on you (or me) touching a dashboard setting correctly.

This is a bigger, more careful change than a header tweak, because it touches how every HTML page in the app is served (there are 335+ pages that reference `theme.css` alone). I did not do this casually — here's what I actually checked:

- Every one of the ~335 pages uses the exact same literal `href="/theme.css"` (and the 4 other coupled files: `career-hub.css`, `career-hub.js`, `app-theme.css`, `style.css`) — confirmed by grepping the whole `public/` tree, so the rewrite is uniform and mechanical, not guesswork per page.
- The virtual routes that don't correspond to an on-disk file with the same name (`/dashboard`, `/login`, `/signup`, `/blog`, `/preview` all serve `app.html`/`blog/index.html` under a different URL) needed their own explicit fix — a generic fallback wouldn't have caught these, and missing them would have left the exact pages this bug was reported on (the dashboard, Skills Lab) still broken.
- Direct requests to the asset files themselves (`/theme.css`, `/career-hub.js`, etc.) still serve as CSS/JS, unaffected — verified this doesn't accidentally intercept them.
- Every existing redirect (`/app` → `/dashboard`, the `/teal-alternative` legacy redirects, the `.html` → clean-URL canonical redirect) still takes priority, unchanged.
- API routes, personal site pages (`/site/:sub`), share links (`/r/:slug`) — none of these are touched by this change; verified they still 404/200 correctly for known and unknown cases.
- A stale `?v=` from an old deploy on an asset URL still resolves to the current file (the version string is cosmetic for cache-busting purposes; it was never a real parameter the server reads).

## Verification (all done locally, before opening anything)

- New test file `test/html-asset-versioning.js` — boots the real app and makes real HTTP requests: 22 checks, all passing, covering every page type above.
- Full existing suite: 25 files, all passing.
- Playwright, live in a real Chromium browser against the actual running app: hero title screenshot (attached to this session) and the full profession-switcher flow (before/after Skills Lab content dump, confirmed identical to what a real user would see, no reload).

## What I could NOT verify, for full honesty

I still don't have Railway or Cloudflare dashboard access this session, so I can't personally go set "Browser Cache TTL: Respect Existing Headers" even though that's the more surgical underlying fix. I didn't wait on it — the version-stamped URLs work regardless of that setting, so nothing further is required for this to work. If you want the belt-and-suspenders version (both fixed), the Cloudflare dashboard change is: your zone → **Caching → Configuration → Browser Cache TTL → "Respect Existing Headers."** Not required for this fix to work; just closes the loop on *why* it broke.

## Files changed
`server.js` (the version-stamping mechanism + updated routes), `test/html-asset-versioning.js` (new).

Local testing and confirmation are done, per your instructions — opening the PR now.
