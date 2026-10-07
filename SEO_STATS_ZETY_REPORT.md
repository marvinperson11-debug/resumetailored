# Stats removal + Zety verification + Teal/Jobscan data (Oct 7, 2026)

## 1. "75% rejected by ATS" / "40% more callbacks" removed
No "40% more callbacks" string existed on the site; the equivalent unsourced callback stat was **"5–10× more callbacks / higher response rate"**, which sat beside the 75% tile on three pages. I removed both families. Replacement framing: "ATS filters screen resumes before a recruiter ever reads them."

Changed: homepage EN + ZH (feature card and the EN/ZH translation arrays), /how-it-works, /free-ats-resume-checker (heading, stat tile, mini-stats), /tailor-resume-to-job-description, /ai-resume-tailor (both stat blocks), zh/english-resume (3 places), zh/blog/english-resume-guide, flyer-beat-the-bots (HTML + re-rendered PNG), social-media/post-2-ats.svg, llms.txt (+ date), blog/how-to-beat-ats-filters.md (stat box).
No platform/locale JSON contained either stat.

**Guard:** `test/comparison-claims.js` now fails on `75% of resumes`, `>75%<` tiles, `75%的简历`, `约 75% 的`, `40% more callbacks`, `5–10x/×`; it also scans `.svg`.

**Left alone, same family — your call:** "97%/98%/99% of Fortune 500 use ATS" (checker FAQ + JSON-LD, 2 blog posts), "score above 80% significantly increases your chances" (checker FAQ), "40% increase in recruiter InMail" (linkedin-profile-tips), "2x to 5x better response rates" (ai-resume-rewriter-vs-builder), "45 min" / "30–60 min" to tailor manually.

## 2. /zety-alternative
Rebuilt to the verified standard: dated "verified October 7, 2026" line, comparison table with "Check official site" flags, source links, FAQ + JSON-LD updated, removed the "no surprise auto-renew" insinuation and the "beats a static builder" framing (Zety has AI features).
**Caveat:** zety.com/pricing and /pricing/t3a returned HTTP 503 to every fetch from this environment. The Zety figures ($1.95 14-day Pro trial → $25.95 per 4 weeks; annual $5.95/mo, $71.40 upfront; free plan downloads limited to .txt) come from search results quoting Zety's own pricing page, corroborated by several review sites, which also report regional/promo variants ($1.70–$2.95 trials). The page says so. **Please eyeball zety.com/pricing once in a browser.**

## 3. Teal / Jobscan data (your Oct 7 spot-check) applied
Teal: free-plan credits (10 bullets, 2 summary, 2 cover letter), top-5 keywords, basic analysis; Teal+ $13/wk, $29/30d, $79/90d (~$26.33/mo), no annual plan.
Jobscan: 5 match scans + free resume builder; $49.95/mo, $89.95/qtr (~$29.98), ~$24.95/mo annual ($299.40/yr); Premium incl. unlimited scans, LinkedIn, AI Cover Letter Generator; Auto Apply (June 2026, paid credits); match rate = keyword overlap not ATS simulation; refund 2 calendar days / unused only / 3.5% fee; pricing page behind login.
Applied in `scripts/build-alternatives.js`, `scripts/blog/comparison-posts.js` (regenerated /alternatives/teal, /jobscan and both blog posts + scanners-compared), homepage/ZH/checker/flyer "5 match scans". The $24.95 guard was narrowed to Resume.io only.

## 4. Testimonials
Stay removed.

## Batch C
Held until you report back on indexing.

## URLs to resubmit
/zety-alternative, /alternatives/teal, /alternatives/jobscan, /blog/teal-vs-resumetailored, /blog/jobscan-vs-resumetailored, /blog/free-ats-resume-scanners-compared, /, /zh/, /how-it-works, /free-ats-resume-checker, /tailor-resume-to-job-description, /ai-resume-tailor, /zh/english-resume, /blog/how-to-beat-ats-filters
