# SEO batch 1 — Batch A: "alternative to" pages

## URL decision (per your answer)
`/rezi-alternative`, `/jobscan-alternative`, `/teal-alternative` keep their 301s to `/alternatives/*` (deliberate consolidation, untouched, now pinned by a test). Batch A is therefore:

| URL | Status |
|---|---|
| `/alternatives/rezi` | existing page, **rebuilt in place** |
| `/alternatives/jobscan` | existing page, **rebuilt in place** |
| `/alternatives/teal` | existing page, **rebuilt in place** |
| `/alternatives/breezy` | **new** (employer) |
| `/alternatives/workable` | **new** (employer) |
`/zety-alternative` untouched. `/for-employers` returns **200** (verified before pointing the employer CTAs at it).

## Audit of the 3 existing pages vs the batch-A spec
All three failed the spec, so they were rebuilt rather than patched:
- Title 69–79 chars (limit 60); meta 212–228 chars (limit 160); FAQPage JSON-LD only, no WebPage.
- No "verified as of" date and no unverified markers; CTAs went to `/dashboard` (spec: candidate → homepage).
- **Factual problems:** Rezi page said the free tier is "limited" and its cover letters "require heavy editing" — Rezi's own pricing page lists unlimited free cover letters. Teal page said Teal has "no cover letter feature" — Teal's free plan includes cover-letter credits and Teal+ lists unlimited. Jobscan page said Jobscan has no cover letters — its plan page lists an AI cover letter generator on Premium. Our own column said job tracker was "coming soon" (a free tracker exists) and the Teal page said the free tier was "1 rewrite per day" (it is unlimited). Several unsourced claims (GPT-vs-Claude "quality gap", "88% ATS parse rate", invented sample bullets attributed to GPT) were removed.

## What each page now has
Title ≤ 60 / meta ≤ 160 / unique H1; WebPage + FAQPage JSON-LD generated from the same data as the visible FAQ (a test enforces identical text); comparison table with competitor facts from the competitor's own pricing page, dated **October 7, 2026**, linked to the source, and **"Check official site"** wherever we could not confirm; a "where each is stronger" section that credits the competitor; CTA → `/` (candidate) or `/for-employers` (employer); links to the long-form blog comparison and sibling pages. Mobile table stacks into labelled cards (the old 3-column table clipped at 390px).

## Sourcing and caveats (please read)
- Verified by fetching the official pricing page: **Rezi, Breezy HR, Workable**.
- **Jobscan and Teal block automated fetching** (403 / JS-only). Their figures come from search results of their own official pages and help center, and are labelled "per Jobscan/Teal". Jobscan's plan page may be dated (search tool flagged it), so please eyeball both against the live pricing pages before submitting to Search Console.
- Our-side facts come from `public/pricing.html` / `/for-employers`. We do **not** claim multiposting (we don't offer it); the employer pages say so plainly.
- Where a competitor's AI model or job-URL import is not stated on their pricing page we say "Check official site" instead of asserting a difference.

## Technical
- Generator: `scripts/build-alternatives.js` (one data table → HTML, so table/FAQ/JSON-LD can't drift; run `node scripts/build-alternatives.js` to regenerate). Page chrome reused from `kickresume.html`.
- Sitemap: 2 new URLs added, 3 lastmods bumped, XML valid (336 `<url>`).
- Internal links added: homepage footer and `/faq` footer (vs Teal / Breezy / Workable); 8 `/tools/*` footers (vs Rezi / Jobscan / Teal); blog → landing cards on `jobscan-vs-resumetailored` and `best-ats-for-small-business`.
- Performance (local Lighthouse mobile, 3-run medians): `/alternatives/breezy` **100** (FCP 0.76 s, LCP 1.7 s, CLS 0); `/alternatives/rezi` **100** (FCP 0.70 s, LCP 1.8 s, CLS 0). Analytics loads on first interaction like the homepage; GSAP/Lenis stack omitted.
- Tests: new `test/alternatives-pages.js` (title/meta limits, uniqueness, JSON-LD parity with visible FAQ, sitemap, CTA targets, links resolve, 301s intact, no unsourced superlatives). Full `test/*.js` loop passes.

## Deliberately not changed / flagged
- `/alternatives/kickresume` untouched (not in scope) but has the same old-style unsourced claims; worth the same rebuild.
- Existing blog posts (`why-rezi-cover-letters-fall-short`, `rezi-vs-resumetailored`, etc.) still assert GPT-vs-Claude quality claims and that Rezi covers letters need heavy editing — contradicted by Rezi's pricing page. I added links only, per "no copy changes to existing pages"; recommend an accuracy pass.
