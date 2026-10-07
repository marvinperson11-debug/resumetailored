# Batch A.5 — competitor-claim accuracy pass

Scope you set: `/alternatives/kickresume` and the old comparison posts with the unsourced GPT-vs-Claude / quality claims. The audit found the same class of problem in more places, so the pass covers every served page that carried it. Competitor facts below were re-verified on **October 7, 2026**.

## Most serious findings (removed)
1. **Named testimonials that look fabricated**, on `/resume-io-alternative` and the Kickresume page and their old flat copies: e.g. "UX Designer, recently hired at Figma", "Data Analyst, ex-Resume.io subscriber", an "interview rate 5% to over 30%" quote. **If any of these were real, send me the source and permission and I'll restore them with attribution; otherwise they should stay out.**
2. **Invented tests and statistics:** "We tested both… seven recruiters blind-reviewed" (`why-claude-writes-better-resumes`), "Claude bullets land 40% more interview callbacks than GPT", side-by-side "GPT-4 output (Rezi)" examples written by us and attributed to a competitor's model, "We tested every major free ATS scanner".
3. **False or stale statements about competitors:** Rezi "free tier: trial only" / "cover letters need heavy editing" (Rezi's own pricing page lists unlimited free cover letters); Teal "no cover letter functionality at any price" (Teal's free plan gives cover-letter credits and Teal+ lists unlimited); Jobscan "no cover letter generation / score only" (its plan page lists AI optimizations and an AI cover letter generator on Premium); Kickresume "$4.50/mo" (its pricing page: $8–$24/mo; also includes an AI writer and ATS checker); Resume.io "$24.95/month", "zero AI", "no ATS optimization" (its page: 7-day $2.95 trial then $29.95 every 4 weeks, or $49.95 per quarter; AI promoted); Enhancv "~$25/month" and "tailoring isn't its focus" (its page lists tailoring and an ATS check; price text unreadable); "GPT-4" attributed to Rezi, Teal and Kickresume (never verified).
4. **A misattribution:** `resume-keywords` said "75% of resumes are rejected by ATS… according to research by Jobscan".

## What changed (all deployed together)
- **Rebuilt from verified data** (same generator as batch A, `scripts/build-alternatives.js`): `/alternatives/kickresume`, `/resume-io-alternative`, `/enhancv-alternative` (URLs unchanged). Each has dated, linked sources, "Check official site" for anything unconfirmed, a "where each is stronger" section (Kickresume's yearly plan is genuinely cheaper than our Pro, and the page says so), WebPage + FAQPage JSON-LD, CTA → homepage.
- **Seven posts rewritten in place** (same URLs/chrome/related links; `scripts/build-comparison-posts.js` + `scripts/blog/comparison-posts.js`; `.md` sources regenerated): rezi-vs-, teal-vs-, jobscan-vs-resumetailored; why-rezi-cover-letters-fall-short (retitled "Rezi Cover Letters: What the Free Plan Includes and How to Judge Them" with a checklist); why-claude-writes-better-resumes (retitled "Claude vs ChatGPT for Resumes: How to Compare Them Yourself": states we have no published study and gives a fair-test method); free-ats-resume-scanners-compared (sourced free-tier table); resumetailored-vs-canva (no claims about Canva's prices or AI, since Canva's pages couldn't be retrieved). Titles/meta/JSON-LD/stat boxes updated; "Updated October 7, 2026" shown.
- **Corrected in place:** `best-ai-resume-builders-2026`, `best-resume-tools-international-job-seekers` (comparison table now says "Check official site" where unverified; "job tracker coming soon" → free tracker), the homepage and Chinese-homepage comparison card (EN + ZH arrays), two flyers, the comparison table on `/free-ats-resume-checker`, `llms.txt` (AI-crawler index), blog index excerpts and every related-card title that used the old headlines.
- **Statistic removed** where we touched the post: "88% / 75% of resumes rejected by ATS" and "40% more callbacks" in `how-to-tailor-resume-with-ai`, `tailor-resume-to-job-description`, `how-to-beat-ats-filters`, `resume-keywords` (their stat boxes now say Match / Plain / True).
- **Deleted** the four unreachable flat files (`rezi|teal|jobscan|kickresume-alternative.html`) that held the fabricated testimonials; their URLs still 301 to `/alternatives/*` (unchanged, tested).
- Social images for two retitled posts re-rendered.
- **Guard:** `test/comparison-claims.js` fails the build if any of these patterns return anywhere under `public/` (GPT-4, "heavy editing", stale prices, testimonial blocks, "score only", claimed tests, 40%-callback claims…); `test/alternatives-pages.js` extended to the new pages. Full `test/*.js` loop passes.

## URLs to resubmit in Search Console (content changed; same addresses)
https://resumetailored.com/alternatives/kickresume
https://resumetailored.com/resume-io-alternative
https://resumetailored.com/enhancv-alternative
https://resumetailored.com/blog/rezi-vs-resumetailored
https://resumetailored.com/blog/teal-vs-resumetailored
https://resumetailored.com/blog/jobscan-vs-resumetailored
https://resumetailored.com/blog/why-rezi-cover-letters-fall-short
https://resumetailored.com/blog/why-claude-writes-better-resumes
https://resumetailored.com/blog/free-ats-resume-scanners-compared
https://resumetailored.com/blog/resumetailored-vs-canva

## Found but deliberately not changed (needs your call)
- **The "75% of resumes are rejected by ATS" and "40% more callbacks" marketing statistics remain on the homepage (EN + ZH), `/how-it-works`, `/free-ats-resume-checker`, `/tailor-resume-to-job-description` and a few other pages.** They are not competitor claims and sit in core copy with translations, so I did not edit them unasked, but our own Canva post called the 75% figure unsourced. Recommend removing or sourcing them (legal/trust review).
- `/zety-alternative` reads as already hedged ("some users have noted…"); I did not change it. It has not been re-verified against Zety's pricing page.
- `CLAUDE.md` still has an internal competitor table ("Rezi: GPT-based", "Teal: no AI rewriting on free tier") that is no longer accurate; internal doc, not served.
- Jobscan and Teal block automated fetching: their figures come from search results of their own official pages/help center (labelled "per Jobscan/Teal"). Canva's pricing page was also blocked, so the Canva post makes no Canva price/feature claims. Please spot-check Jobscan/Teal against their live pricing pages.
- Templates (batch C) are still waiting on your go-ahead after you've watched indexing.
