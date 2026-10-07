# SEO batch 1 — Batch B: profession resume-writing guides

## URLs (10)
https://resumetailored.com/resume-writing-for-nurses
https://resumetailored.com/resume-writing-for-teachers
https://resumetailored.com/resume-writing-for-software-engineers
https://resumetailored.com/resume-writing-for-sales-representatives
https://resumetailored.com/resume-writing-for-project-managers
https://resumetailored.com/resume-writing-for-accountants
https://resumetailored.com/resume-writing-for-customer-service-representatives
https://resumetailored.com/resume-writing-for-warehouse-associates
https://resumetailored.com/resume-writing-for-marketing-managers
https://resumetailored.com/resume-writing-for-electricians

## What each guide is (and is not)
Instructional, 900–1,200 profession-specific words each (the build refuses anything under 600): who screens and for what; **licenses/certifications and how to list them** (e.g. RN license + compact status, state teaching certificate/endorsements/Praxis, PMP/CAPM/PRINCE2, CPA/CMA/EA, forklift training under OSHA rules, apprenticeship/journeyman/master); **grouped ATS keyword lists** for the field (with spelled-out vs. acronym tips); a **5–7 step section-by-section walkthrough** with labelled illustrative samples; common mistakes; where jobs are posted and which ATS families are typical (Workday/iCIMS/Taleo for hospitals, Frontline for districts, Greenhouse/Lever for tech, etc., hedged as "commonly"); 5-question FAQ. Not re-skins of the example pages.

## Intent separation from the existing `/…-resume` pages
The existing `/…-resume` pages are *AI-tailoring landing pages* titled "<Role> Resume: Tailor It to Any Job with AI (Free)". The guides are titled "How to Write a <Role> Resume: …" with H1 "Resume Writing for <Role>: A Step-by-Step Guide". They share the head term (unavoidable) but not the modifier: a build check rejects any guide whose title/H1 uses tailoring-tool words ("tailor", "with AI", "free") or repeats the example page's title/H1, and a test re-asserts it.

## Linking
- Guide → its tailoring page, and tailoring page → guide (9 pages edited: one added sentence each). **Note:** the existing `/…-resume` pages contain no finished sample resume, so the link is worded honestly ("…resume tailoring page"), not "see a finished example". Each guide instead embeds illustrative sample lines (placeholders labelled "Illustrative only — replace with your own real numbers").
- `/resume-writing-for-warehouse-associates`: **no `/warehouse-…-resume` page exists**, so it links to the `/resume-examples` hub instead. Consider adding a warehouse tailoring page later.
- Each guide links to two sibling guides; the `/resume-examples` hub gained a "Resume writing guides" section with all 10; sitemap +10 URLs (valid XML, 346 `<url>`).
- Template links from the guides (planned "profession → relevant templates") wait for batch C so they don't point at pages that don't exist yet.

## Quality/technical
- Title ≤ 60, meta ≤ 160, unique title/meta/H1, WebPage + FAQPage JSON-LD generated from the same data as the visible FAQ (test enforces identical text), one H1, canonical.
- Mobile Lighthouse (local, 3-run medians): nurses **100** (FCP 0.72 s, LCP 1.8 s, CLS 0), electricians **100**. No horizontal overflow at 390 px.
- Generator `scripts/build-resume-guides.js` + data in `scripts/guides/*.js`; new `test/resume-guides.js`; full `test/*.js` loop passes.

## Accuracy notes / what I deliberately did not do
- Facts about licensing are kept general and pointed at the relevant authority (state boards, jurisdiction rules) rather than asserting state-specific rules. Items worth a subject-matter reread before heavy promotion: PMP "35 contact hours" wording, CPA "commonly 150 semester hours", OSHA forklift-training wording, apprenticeship length ("commonly four to five years").
- ATS-vendor statements are hedged ("commonly"); no claim about any specific employer's system.
- No salary figures, pass rates or "% of recruiters" statistics were included (none were verifiable).
- Not shipped: template cross-links (batch C), a warehouse tailoring page.
