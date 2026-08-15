# Response — ResumeTailored Landing Page Fixes

## Open questions
**None.** Nothing about the task was ambiguous enough to block on. Where an issue
offered options (a)/(b), I picked the lower-risk, cleaner one and noted it below.
If you'd like any of those decisions changed, tell me and I'll adjust.

## What I did
Fixed the marketing landing page (`public/index.html`) plus one test. **7 of the
10 items were genuinely present and fixed; 3 were already correct** in this
snapshot and verified in the rendered page.

| # | Issue | Result |
|---|-------|--------|
| 1 | Lifetime "Saves $99+" (Rezi $149 vs our $129) | → **"Saves $20+ vs. Rezi Lifetime"** |
| 2 | Duplicate "New Tools" + "What's New" sections | **Merged into one** "What's New" (all 9 cards kept) |
| 3 | FAQ implied signup for free tier | Rewritten to **"…no credit card and no account required."** (visible + JSON-LD + 中文) |
| 4 | Testimonial attribution | **Already correct** — all three carry name/title |
| 5 | Sample skills run-together | **Already correct** — renders as separated pills |
| 6 | Static "May 28, 2026" cover-letter date | Now renders **today's date** via `stampDates()` (localized EN/中文) |
| 7 | Inflated "40+ more" platforms claim | → **"more added regularly — any URL-accessible job post works"** |
| 8 | "Click any feature to unlock" (not a control) | → real **"Upgrade to Pro to unlock these features →"** button |
| 9 | Two redundant Employer CTAs | Distinct labels: **"Open the Employer Portal →"** / **"See how it works →"** |
| 10 | Hero tagline spacing | **Already correct** — spaced across three `<br>` lines |

## Decisions I made (where the brief gave options)
- **#6 date** — chose *(a) dynamic today's date* over a relative phrase, so the
  sample never goes stale and stays correct in both languages.
- **#7 platforms** — chose *(b) remove the number* ("more added regularly — any
  URL-accessible job post works") rather than padding the visible list to 40+.
- **#8 unlock CTA** — chose *(b) a single real CTA button* ("Upgrade to Pro…")
  rather than wiring each tile, since the tiles already had click handlers.
- **#9 employer CTAs** — the two links go to *different* destinations, so I made
  the labels distinct rather than deleting one.
- **#4 / #5 / #10** — already correct in the source; verified rather than
  changing, to avoid needless churn.

## Note on the bilingual toggle (why #2 touched more than HTML)
The EN/中文 toggle targets section headings by **positional index**. Removing one
section shifted the trailing indices, so I decremented the Pricing/FAQ entries,
updated the `contain-intrinsic-size` CLS fallbacks, and re-verified DOM alignment
with the Chinese dictionary.

## CI
The first CI run failed one test that hardcoded "12 below-the-fold sections."
Merging two sections into one legitimately reduced that to 11, so I updated the
test's assertion/comment to 11 and pushed. Full suite passes locally by exit code
(the same check CI uses). I'm still watching the PR.

## Links & artifacts
- **Pull request (draft):** https://github.com/marvinperson11-debug/resumetailored/pull/385
- **Branch:** `claude/resumetailored-site-fixes-fh0gmv`
- **Netlify deploy preview:** https://deploy-preview-385--mellow-macaron-463353.netlify.app
- **Detailed technical write-up:** `SITE_FIXES_REPORT.md` (in the repo/branch)

## Commits
1. `Fix landing page copy: pricing, dupes, no-account, dates, CTAs`
2. `Update content-visibility test for merged promo section`
3. `Expand fixes report with PR link, CI note, and commit list`
