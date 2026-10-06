# SEO + analytics fixes — report

**Status:** code changed, tested locally, **not yet deployed** (this session has no deploy access; merge the PR and let Railway build). Live checks below are against the *pre-change* production site, so they show the "before" state; re-run the post-deploy commands at the bottom.

**Key finding:** all Stripe code lives in the legacy `server.js`. `resumetailored-platform/` only proxies checkout creation to it (`create-checkout-session`, `create-employer-checkout-session`), so the GA4 fix is in `server.js`, not the Next.js app. Nothing under `resumetailored-platform/` or app.resumetailored.com was touched.

## 1. Homepage title + description (`public/index.html`)
- `<title>`: `AI Resume Tailoring That Gets Interviews | ResumeTailored` (57 chars).
- Description (154 chars): "AI resume tailoring that rewrites your resume for each job, plus a matching cover letter in seconds. ATS-friendly keywords. Free to start, no credit card."
- **Not changed:** `og:title`, `og:description`, `twitter:*` and other pages' titles (scoped as asked). OG/Twitter titles still carry the old wording — say so if you want them aligned.

## 2. `/yourname` redirect error
- Repo already had `app.get('/yourname') → 301 /` (server.js) and a Netlify equivalent. Live, with a Googlebot UA: `/yourname` → 301 `/` → 200, 2 hops, no loop; `/yourname/` and `/Yourname` behave the same. `http://` first does a 301 to https (3 hops total).
- I could not reproduce a redirect error; GSC's Aug 9 crawl most likely predates that fix. **No code change** — recommend "Validate fix" in GSC.
- Real personal sites (`/site/:name`, `<sub>.resumetailored.com`, platform middleware) untouched.
- **Found, not changed:** `www.resumetailored.com/yourname` (and `www` generally) returns 404 — `www` is served by something that isn't this app. Worth a DNS/Cloudflare redirect `www → apex`, outside this repo.

## 3. `/site/` 404
- `/site/` is the bare prefix of the personal-site route `/site/:name`; it never had a page (Google likely extracted it from the "/site/yourname" example text). It was not in the sitemap and nothing links to it.
- Added `GET /site` and `/site/` → 301 `/blog/resume-website-builder` (topical page, avoids a soft-404 that redirecting to `/` would risk), plus a Netlify-preview equivalent. Verified locally; `/site/:name` still routes normally.

## 4. GA4 `purchase`
- **Why 0 events:** Stripe's `success_url` is the bare `https://app.resumetailored.com` — no session id, no return-page hook — so there was never a client-side path that could carry the purchase. It wasn't (only) ad blockers.
- **Fix:** new `ga4-purchase.js` (GA4 Measurement Protocol), called from the `checkout.session.completed` branch of `/webhook`. This is the **only** path; I added no client-side fallback (nothing to hang it on without changing the success URL).
- Event name `purchase`; params `transaction_id` = Stripe session id, `value` (= `amount_total/100`), `currency`, plus one `items[]` entry (`pro_monthly`, `pro_lifetime`, `employer_<tier>`). Covers Pro $19/$129 and employer Portal/Scale/Corporate (all go through this webhook; value comes from the real amount charged).
- **Exactly once:** claim-before-send in `usage_store` keyed `ga4purchase_<session id>`; Stripe retries/replays are skipped. A failed send releases the claim so a retry can still land. GA4 also dedupes on `transaction_id`. Only fires when `payment_status === 'paid'`.
- Fire-and-forget: never blocks or fails the webhook (still always 2xx after signature check).
- **ACTION REQUIRED:** the code is inert until you set **`GA4_API_SECRET`** in Railway (GA4 Admin → Data streams → your stream → Measurement Protocol API secrets). Optional `GA4_MEASUREMENT_ID` (defaults to `G-JWC76X5X68`, the ID the site already uses).
- **Limitation:** the webhook has no browser, so `client_id` is a stable pseudo-id derived from the Stripe customer. The purchase counts as a key event but won't attribute to the visitor's original source/campaign. To fix later, pass the `_ga` cookie client id into checkout metadata.
- Tests: `test/ga4-purchase.js` (payload shape, plans, unpaid, inert w/o secret, dedupe, retry-after-failure, never throws, webhook wiring). `test/stripe-webhook.js` and the whole `test/*.js` loop pass.

## 5. Sitemap sweep
Fetched all 335 URLs on live with a Googlebot UA; 3 were not 200:
- `/ai-resume-tailor` → 301 app.resumetailored.com — **removed**
- `/score` → 301 app.resumetailored.com — **removed**
- `/tools/resume-video` → 302 `/resume-video` — **replaced** with `/resume-video` (the 200 canonical)

Now 333 URLs; all 333 return 200 against the patched server locally. **Not changed:** the deprecated-route redirects themselves (intentional, per `server.js`), and internal links to those routes.
- Side note: `HEAD` on blog posts (e.g. `/blog/resume-website-builder`) returns 404 while `GET` returns 200 — pre-existing quirk, harmless to Googlebot, not changed.

## Verify after deploy
```
UA="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
curl -s -A "$UA" https://resumetailored.com/ | grep -E "<title>|name=\"description\""
curl -sIL -A "$UA" https://resumetailored.com/yourname | grep -iE "^HTTP/|^location"
curl -sI  -A "$UA" https://resumetailored.com/site/ | grep -iE "^HTTP/|^location"   # 301 -> /blog/resume-website-builder
curl -s https://resumetailored.com/sitemap.xml | grep -c "<loc>"                    # 333
```
Then do one real/test-mode checkout and confirm the event in GA4 → Admin → DebugView / Realtime (key event `purchase`).
