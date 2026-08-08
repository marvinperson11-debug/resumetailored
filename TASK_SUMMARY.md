# TASK_SUMMARY — Remove AdSense from product pages + defer Analytics (mobile perf hotfix)

Date: 2026-08-08. Branch: `claude/markdown-file-response-y8qolt`.

Follows the 63→43 mobile investigation (`PERF_DIAGNOSIS.md`, delivered separately): the font PR was live and correct; the score was AdSense-driven lab-run noise. This hotfix removes AdSense from the product surfaces and defers Analytics on the homepage.

## Key finding (changes the brief)

**AdSense was on exactly 3 files — the homepages and the app — and on ZERO blog/content pages.** Audit (`grep -rl "googlesyndication\|adsbygoogle" public`):
- `public/index.html` (homepage) — AdSense loader
- `public/zh/index.html` (Chinese homepage) — AdSense loader
- `public/app.html` (dashboard) — AdSense loader + a rewarded-ad "watch an ad to download" gate

So "keep AdSense on blog posts / content pages" had **nothing to keep** — there was no AdSense there to begin with. And "delay AdSense on pages that keep it" had **no target**, because every page that had AdSense is one the brief says to remove it from.

## What shipped

1. **AdSense removed entirely** from `index.html`, `zh/index.html`, and `app.html`:
   - The `adsbygoogle.js` script tag on all three.
   - In `app.html`, the whole rewarded-ad gate (`adGateModal` markup, the `<ins class="adsbygoogle">` unit, and the `adGate`/`completeAdGate`/`closeAdModal` functions + `ADSENSE_SLOT_ID`). This was **dead code** — its slot was never configured (`REPLACE_WITH_SLOT_ID`), and nothing called `adGate()`; downloads go through `showDownloadGate` → the auth modal, which is untouched. So downloads behave exactly as before, minus a modal that never actually showed an ad.
2. **Option A delay, applied where it can act — the homepages.** Since no ad-bearing content page exists to attach it to, the only remaining third party on the PageSpeed target page (the homepage) is Google Analytics. GA now loads **lazily on the first interaction** (`scroll`/`pointerdown`/`keydown`/`touchstart`/`mousemove`) **or after a 3s timeout**, whichever comes first — so it never runs during the initial render. `window.gtag` is still defined synchronously and `gtag('js'/'config')` is queued immediately, so any event calls elsewhere on the page keep working and flush once GA loads. Applied to `index.html` + `zh/index.html`. `app.html` keeps GA eager (it's behind login, not a PageSpeed target).

**Analytics tradeoff (small, revertible):** a visitor who lands on the homepage and leaves within 3s **without any interaction** won't be counted by GA. That's a low-value bounce for analytics, and it's the mechanism that removes GA from the critical path. Easy to revert if you'd rather keep homepage GA eager.

## Before / after PageSpeed (mobile, homepage)

| | Mobile Performance |
|---|---|
| Before (your screenshot, single lab run) | **43** |
| After | **must be measured post-deploy** — see note |

**I could not run the 3× PSI average from this environment.** Field PageSpeed Insights needs a public URL and only sees `main` (this branch deploys on merge); the PSI **API is quota-exhausted** for the shared key here; and headless Chrome can't reach external URLs through the sandbox proxy (TLS interstitial). So the after-numbers have to be captured once this merges and Railway deploys.

**To measure (please run after deploy, or I can if given a path with PSI access):** run `https://pagespeed.web.dev/` on `https://resumetailored.com/` (Mobile) **3 times**, average the Performance scores, and record them here. Removing AdSense auto-ads — the dominant mobile TBT/LCP cost — plus deferring GA should land the homepage well into the 80s–90s; the exact number depends on the field run. (Note: the page still shows **"No Data"** for CrUX field metrics, so the lab score will remain somewhat run-to-run variable until real-user data accumulates.)

## Tests

`test/no-adsense.js` (new) guards the policy: no `adsbygoogle`/`googlesyndication` on `index.html`/`app.html`/`zh/index.html`, no ad-gate leftovers in `app.html`, the real download flow intact, and the homepages defer GA (no eager `gtag.js`, `window.gtag` still defined, load bound to interaction + timeout). Full suite: **33 files green**.

No visual regressions — the homepage looks identical; it just no longer loads ad scripts, and Analytics starts on first interaction.
