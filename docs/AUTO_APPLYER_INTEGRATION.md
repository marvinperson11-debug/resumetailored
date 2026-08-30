# Auto-Applyer (AutoApply) — wiring & integration report

Branch: `claude/auto-applyer-integration-at0p0d` · Draft PR: [#421](https://github.com/marvinperson11-debug/resumetailored/pull/421)

## 1. Where the Auto-Applyer lives

Two distinct pieces:

- **Marketing landing page** — `public/tools/autoapply.html`, served at **`/tools/autoapply`**
  (via `express.static({ extensions: ['html'] })`). Explains the tool and links to the app
  (`/dashboard`) and the browser extension. This was already reachable.
- **The actual tool** — an entire **separate Next.js app + Chrome extension** under `autoapply/`
  (its own `package.json`, Prisma schema/DB, `autoapply/extension/`). It is a **standalone
  deployment** and is intentionally **not** mounted into `server.js`; the landing page and Job
  Finder hand off to it. Fully mounting that app is out of scope for this change.

## 2. What was broken/missing → what was fixed

The premise ("not visible, not connected") was partly outdated — AutoApply already had a landing
page, a homepage promo card, and a card on `/score`. The genuine gaps and their fixes:

| Missing | Fixed |
|---|---|
| No Job Finder connection | **⚡ Auto-Apply** button on every Job Finder result + feed job; a `localStorage` **apply queue** (`rt_aa_queue`); a **"My Apply Queue"** panel + link in the Job Finder aside; a first-run **setup gate** that opens `/tools/autoapply` and remembers the job so it lands in the queue once setup completes (`public/career-hub.js`, EN + ZH i18n; new functions exported on `window.CareerHub`). |
| Not in nav/footer | Added to the `site-nav.js` hamburger product directory, both homepage mobile menus, and the homepage footer link row. |
| Absent from `llms.txt` | Added **AutoApply**, **Job Finder**, and **Share Resume as a Link** entries. |
| Tool pages didn't cross-link each other | New shared **`public/related-tools.js`** renders one consistent "Related tools" block (omitting the current page) on all **18** tool landing pages; replaced two partial hardcoded "More Free Tools" blocks (`ats-keyword-extractor`, `resume-video`) with a `#relatedTools` mount. |

## 3. Landing pages: existed vs. created

- **Already existed** (just cross-linked): ATS Score Checker, Readability Review
  (`/resume-analyzer`), ATS Keyword Extractor, AI Resume Tailor, AI Cover Letter Generator,
  LinkedIn Optimizer, Job Application Tracker (`/job-tracker`), Resume/Cover-Letter Examples,
  Salary Negotiation, Resume A/B Tracker, Offer Comparison, Job Description Decoder, Weekly
  Report, Follow-Up Generator, Mock Interview, Auto-Applyer. Job Finder is an in-app feature →
  linked to `/dashboard`.
- **Created**: `public/share-resume-link.html` → **`/share-resume-link`** (the only enumerated
  tool without a page).

## 4. Files changed

**New**
- `public/related-tools.js` — shared cross-link component.
- `public/share-resume-link.html` — new "Share Resume as a Link" landing page.
- `test/autoapply-integration.js` — guard test (56 checks).

**Modified**
- `public/career-hub.js` — Job Finder ↔ AutoApply integration + i18n.
- `public/site-nav.js` — AutoApply in the hamburger directory.
- `public/index.html` — AutoApply in both mobile menus + footer.
- `public/llms.txt` — AutoApply / Job Finder / Share-as-a-Link entries.
- 18 tool landing pages — include `related-tools.js`
  (`public/tools/*.html`, `public/ai-resume-tailor.html`, `public/ai-cover-letter-generator.html`,
  `public/ats-score-checker.html`, `public/resume-analyzer.html`, `public/job-tracker.html`,
  `public/resume-examples.html`, `public/cover-letter-examples.html`).

## 5. Verification

- New guard `test/autoapply-integration.js` — **56 checks pass**.
- Full `test/*.js` suite passes locally (`production-e2e` SKIPs on Node 22 by design).
- Server boots; `/tools/autoapply`, `/share-resume-link`, `/related-tools.js`,
  `/ai-resume-tailor`, `/job-tracker`, `/resume-analyzer` all return **200**.
- CI on PR #421: GitHub Actions **`test` ✅ success**; Netlify deploy preview **✅ ready**
  (redirect-rules ✅, header/pages neutral); no merge conflict; no outstanding review comments.

## 6. Open follow-up (needs a decision)

The Job Finder apply queue is a **client-side (`localStorage`) hand-off** into the standalone
AutoApply app — there is no server-side queue table in `server.js`, since the queue's real
backend is the separate `autoapply/` Next.js app + extension. If a **persistent, server-side
apply queue** owned by the main app is wanted instead, that's a follow-up.
