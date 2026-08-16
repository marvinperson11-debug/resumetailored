# Dashboard Refactor — Phase 1 Report (Scrolling / Performance)

Branch: `claude/resumetailored-dashboard-refactor-4mjgrq`
Scope: **Phase 1 only** (the janky-scroll / first-paint performance bug). Phases 2–4 not started.

---

## 1. Files created, moved, or deleted

**Created — `public/panels/` (12 lazy-loaded tab panels):**

| File | From | Notes |
|---|---|---|
| `public/panels/linkedin.html` | app.html | 7.0 KB |
| `public/panels/video.html` | app.html | 8.4 KB |
| `public/panels/ats.html` | app.html | 8.0 KB |
| `public/panels/jobtracker.html` | app.html | mount point only (JS builds the UI) |
| `public/panels/backoffice.html` | app.html | 1.3 KB |
| `public/panels/forum.html` | app.html | 1.2 KB |
| `public/panels/salary.html` | app.html | 5.3 KB |
| `public/panels/checkin.html` | app.html | 4.6 KB |
| `public/panels/help.html` | app.html | 4.7 KB |
| `public/panels/about.html` | app.html | 10.6 KB |
| `public/panels/samples.html` | app.html | 1.1 KB |
| `public/panels/cancel.html` | app.html | 5.1 KB |

**Modified:** `public/app.html` (panel bodies replaced with empty lazy shells; `showTab()` rewritten; head resources deferred; images made lazy; containment CSS added).

**Deleted:** nothing. (No build step, so the extracted markup only exists once — as the panel files. app.html keeps a shell `<div>` for each.)

**Kept inline (deliberately):** `#panel-tailor` (landing tab) and `#panel-website` (the editor shell — `.cv-*`/`ed-*` code is tightly coupled and is Phase 3's job, not Phase 1's).

---

## 2. Before / after size of app.html

| | Lines | Bytes | KB |
|---|---|---|---|
| Before | 10,571 | 748,246 | 731 |
| After | 9,830 | 696,958 | 681 |

That's the byte count. The number that actually fixes the scroll bug is **DOM nodes at first paint**: the 12 panels are ~7,000 nodes that the browser no longer parses, styles, or lays out before the user sees the page. On top of that, `content-visibility:auto` means even the two inline panels' off-screen content is skipped during layout until scrolled to.

---

## 3. What I changed (mapped to the Phase 1 checklist)

**1. Lazy-load tab panels ✅**
- `showTab(name)` now: toggles `.active` on the (already-present) shell → `hydratePanel(name)` fetches `/panels/<name>` once, caches it in a `Map`, injects into the shell (replacing a spinner) → then runs the existing per-tab init (`loadForum`, `initSamples`, …) via `runTabInit(name)`.
- Each shell ships with a CSS spinner (`.panel-loading`/`.panel-spin`) so the first click gives immediate feedback.
- Fetches the **clean URL** `/panels/forum` (not `/panels/forum.html`) because the server 301-redirects `*.html` to the clean path — this avoids a redirect hop on every first open.
- **i18n fix baked in:** the current `applyLangApp()` queries *directly into* panel bodies (`#panel-about h1`, `#panel-linkedin …`) and runs at load for Chinese users. With panels no longer in the DOM at load, those queries would silently no-op. `hydratePanel` re-runs `applyLangApp(currentLang)` after injecting, so Chinese stays correct. (Phase 3's i18n rewrite will make this unnecessary.)

**2. CSS containment ✅** — added exactly as specified: `.tab-content { contain: layout paint; content-visibility: auto; contain-intrinsic-size: 0 500px }`, `.tab-content.active { content-visibility: visible }`, `.cv-shell { contain: layout paint }`, and `.bo-sites, .cv-tplgrid, .template-gallery { contain: layout paint }`. Put in app.html's inline `<style>` (not the shared `style.css`) so it only affects the dashboard.

**3. Defer non-critical resources ✅ (with one deviation — see §5)**
- Google Analytics (`gtag.js` loader + config) moved from `<head>` to end of `<body>`, still `async`.
- **Inter** preloaded via `<link rel="preload" … as="style" onload="this.rel='stylesheet'">` + `<noscript>` fallback, `&display=swap`.
- **Decorative fonts** (Dancing Script, Great Vibes, Satisfy, Caveat, Fraunces, Syne) removed from `<head>` and injected by `loadDecorativeFonts()` on first need: signature input focus, Samples tab open, cover-letter mode, and auth-modal open (so the Fraunces wordmark is correct when the modal first shows).
- **jsPDF:** see §5 — it was dead code, so I removed it rather than lazy-load it.

**4. Reduce selector complexity ⚠️ (intentionally conservative — see §5)**

**5. Lazy images ✅** — `loading="lazy"` + explicit `width`/`height` (or `aspect-ratio`) on `#resumePhotoPreview`, `#videoPhotoPreview`, `#wcQrImg`, and the Back Office `.bo-thumb` iframe.

---

## 4. Breaking changes to test manually

Please click through these in a real browser (I verified the server serves everything and all 39 backend tests pass, but there is no automated browser test for `app.html`):

1. **Every sidebar tab opens** and shows content (Forum, Salary, Check-In, Help, About, Cancel, Samples, Video, Back Office, Job Tracker, LinkedIn, ATS). First click should flash a spinner, then render. Second click should be instant (cached).
2. **Browser back/forward** still moves between tabs (the `history.pushState`/`popstate` path is unchanged).
3. **Chinese UI (`语言` toggle):** switch to 中文, then open a fresh-loaded panel (e.g. About, Cancel) — headings/body should be translated. Also load the page with `rt_lang=zh` already set and confirm panels translate on first open.
4. **Signature section** (Tailor tab, resume mode): the script/elegant/classic/casual font previews should render in their fancy faces after you focus the name field.
5. **Cover-letter mode + PDF/print download:** generate a cover letter, add a signature, Download PDF — the signature font must be correct in the print output.
6. **ATS "Use Resume from Tailor tab"** button still copies text into the ATS textarea.
7. **Job Tracker** tab still mounts the tracker UI.
8. **Back Office** site thumbnails still render (iframe `loading="lazy"`).
9. **A slow/offline first-open** shows the "Couldn't load this section — Retry" message and the Retry link re-fetches.

---

## 5. Trade-offs & deviations (please review)

**A. jsPDF was dead code — I removed it instead of lazy-loading it.**
The checklist asked for a `loadJsPdf()` that injects jsPDF on first download-button hover/click. But **nothing in the entire codebase references `jspdf`/`jsPDF`** — `downloadPdf()` uses a print window (`window.print()`), not jsPDF. The `<script src="…jspdf…">` in `<head>` was a ~350 KB render-blocking download that did nothing. Adding a loader for a library that's never called would just move wasted bandwidth from load-time to hover-time. So I deleted it. If you have an out-of-tree/planned feature that needs jsPDF, tell me and I'll add the lazy loader instead.

**B. Aggressive selector flattening (checklist item 4) — done conservatively, on purpose.**
The one concrete example given — flattening `body.wb-picker .cv-tplgrid .wc-tpl-body .bo-act` to `.cv-tplgrid .bo-act` — is actually unsafe: that rule is deliberately scoped to picker mode, and a **different** `.cv-tplgrid .bo-act` rule already exists (dark-theme colors). Flattening would leak `flex:1 1 0` onto Back Office action buttons. With no automated visual regression test and no way for me to eyeball the result, rewriting the 400+ rule selector graph blind is high-risk for a gain that's already captured elsewhere: `content-visibility:auto` + the panels leaving the DOM removes the *layout* cost of hidden-tab rules, which was the real target. I flattened nothing that could change rendering. **If you want the full flatten, I'd recommend doing it in Phase 3 alongside the CSS extraction, where the rules move to files and can be diffed/tested.**

**C. `applyLangApp` re-run on inject** is a deliberate stopgap so Phase 1 doesn't regress Chinese. It's slightly wasteful (re-walks the DOM on each panel's first open). Phase 3 item 14 (data-driven i18n) removes the need entirely.

**D. No build step means the extracted markup is fetched at runtime**, not inlined at build. Cost: one small `fetch` per tab on first open (cached after). This is the intended design from the checklist and is the right call here.

---

## Questions before I continue to Phase 2

Phase 2 (Security) contains several changes with real product/ops implications. I'd like your call on a few before I touch `server.js`:

1. **jsPDF (§5A):** confirm it's safe to leave removed (recommended), or is there a planned feature that needs it?

2. **Auth cookies (item 7):** moving `rt_token` from `localStorage` to an httpOnly cookie is the right security move, but it changes the auth model. The token today is a **UUID session token** (per the codebase), not a JWT — the checklist says "JWT" a few times. Should I keep the existing UUID session tokens (just also set them as an httpOnly cookie), or is migrating to real JWTs in scope? Keeping UUID + cookie is far less risky.

3. **CSRF (item 8):** the double-submit cookie + `X-CSRF-Token` header will require touching **every** mutating `fetch` in the frontend. That's a large, mechanical change that's easy to get 90% right and have one missed call break silently. Do you want it in Phase 2, or bundled into Phase 3 where I'm already rewriting the fetch call sites?

4. **CSP (item 9):** the provided policy keeps `'unsafe-inline'` for scripts *and* styles (unavoidable until Phase 3 extracts them). That means the CSP provides limited XSS protection until then. OK to ship the permissive CSP now and tighten after Phase 3, as the checklist notes?

5. **Server-side Pro validation (item 10):** do you have a canonical `isSubscriber(email)` I should treat as the single source of truth for **all** Pro endpoints? I want to confirm I won't accidentally lock out lifetime buyers (the `lifetime_<email>` customer_id sentinel).

6. **Deploy/caching:** panel files are served `no-cache` (same policy as app.html and its coupled JS). Good for correctness; confirms you're OK with a revalidation request (cheap 304) per panel on repeat visits.

Say "continue" (with any answers) and I'll start Phase 2.
