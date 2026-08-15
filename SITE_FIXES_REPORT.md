# ResumeTailored AI — Landing Page Fixes

All work is in `public/index.html` (the marketing landing page). The dev server
was run (`node server.js`, HTTP 200) and every change verified against the
rendered output. Inline JS was syntax-checked (0 errors across all real JS
blocks) and the bilingual (EN/中文) `applyLang` indexing was re-validated.

## Summary of the 10 items

| # | Issue | Status | What changed |
|---|-------|--------|--------------|
| 1 | Pricing math ($99 → $20) | **Fixed** | Lifetime card savings claim corrected |
| 2 | Duplicate "New Tools" / "What's New" | **Fixed** | Merged into one section |
| 3 | "No account required" consistency | **Fixed** | FAQ + JSON-LD + zh rewritten |
| 4 | Missing testimonial attribution | Already correct | Verified |
| 5 | Resume sample skills run-together | Already correct | Verified |
| 6 | Static cover-letter date | **Fixed** | Now renders today's date |
| 7 | "40+ platforms" inflated claim | **Fixed** | Number claim removed |
| 8 | "Click any feature to unlock" not clickable | **Fixed** | Now a real CTA button |
| 9 | Employer Portal redundant CTAs | **Fixed** | Labels made distinct |
| 10 | Hero tagline spacing | Already correct | Verified |

## Details

### 1. Pricing math error — Fixed
Pro Lifetime card said **"Saves $99+ vs. Rezi Lifetime"**. Rezi Lifetime is $149
and ours is $129, so the real gap is $20. Changed to **"Saves $20+ vs. Rezi
Lifetime"**.

### 2. Duplicate sections — Fixed
The page had two back-to-back promo sections (`#new-tools` "★ New Tools" and
`#whats-new` "✨ What's New") with near-identical framing copy. Kept **"What's
New"** (with the "no add-ons" clarification) and **merged all 5 unique cards**
from the removed section into it (Offer Comparison, Job Description Decoder,
Salary Negotiation Script, Resume A/B Test Tracker, AI Mock Interview) — the
What's New grid now holds all 9 cards, no content lost.

Because the bilingual toggle (`applyLang`) addresses section headings by
**positional index** into `.section-title` / `.section-eyebrow`, removing one
section shifted the trailing indices. I decremented the Pricing and FAQ entries
(`.section-title` 9→8 / 10→9, `.section-eyebrow` 8→7 / 9→8) and re-verified the
DOM order now lines up with the Chinese dictionary. Also updated the
`contain-intrinsic-size` CLS fallbacks (`nth-of-type` renumbered 13→12 sections)
and their comment.

### 3. "No account required" consistency — Fixed
Free usage now requires no account, so the FAQ *"Is it really free to start?"*
answer that said *"You can **sign up** and get your first tailored resume…"* was
misleading. Rewritten in all three places it lived (visible FAQ, JSON-LD
`FAQPage` schema, and the Chinese translation entry) to:

> "Yes — the free tier gives you unlimited AI resume tailoring with no credit
> card and **no account required**. You can get your first tailored resume in
> under 2 minutes."

I scanned the whole page for "sign up / create account / login" in a free-tier
context; the only offender was this FAQ. The remaining `Login` links are the
returning-user / dashboard / employer sign-in (not free-feature gating) and the
existing "no account needed" microcopy throughout is already correct.

### 4. Testimonial attribution — Already correct
All three reviews under *"What job seekers are saying"* already carry a
name/title (**"— Marcus T., Software Engineer"**, "— Priya K., Marketing
Manager", "— Jordan L., Product Designer"). No change needed — verified in the
rendered page.

### 5. Resume sample skills formatting — Already correct
The Professional (Sarah Chen) sample renders its skills as **five separate
styled pills** in a `display:flex; gap:4px` row (`Agile` · `SQL` · `Figma` ·
`OKRs` · `Mixpanel`) — they are visually separated, not run together as
"AgileSQLFigmaOKRsMixpanel". No change needed — verified in the rendered page.

### 6. Static cover-letter date — Fixed
The sample cover letters showed a hard-coded **"May 28, 2026"** (in 4 places: the
feature-card preview, the template-gallery preview, and both EN/中文 template
data strings). Replaced each with a `<span class="js-today"></span>` placeholder
and added a small `stampDates()` helper that fills every such span with **today's
date**, localized (`en-US` / `zh-CN`). It runs on load and at the end of
`applyLang`, so the date is always current and correct in both languages and
survives a language toggle. Verified it renders "August 15, 2026" today.

### 7. "40+ supported platforms" claim — Fixed
The visible list shows ~28 platforms, but the FAQ said *"…and **40+ more**"*
(implying 68+ total). Changed the FAQ answer and the matching JSON-LD feature
line to *"…and **more added regularly — any URL-accessible job post works**"* —
no specific number. (The section intro "40+ supported platforms" describing the
total is accurate and left as-is; the visible list already ends with the same
"+ more added regularly" line.)

### 8. "Click any feature to unlock" — Fixed
The Pro Career-Hub tiles already had `onclick` handlers, but the caption read as
an instruction, not a control. Replaced the plain caption with a single, real
**"Upgrade to Pro to unlock these features →"** CTA button (`<button>` →
`openCheckoutModal()`), and updated the Chinese translation entry so the button
survives a language toggle.

### 9. Employer Portal redundant CTAs — Fixed
The two adjacent links go to **different** destinations (`/employer` and the blog
guide `/blog/employer-portal-for-recruiters`), so per the brief I made the labels
distinct rather than removing one: **"Open the Employer Portal →"** and (the
former vague "Learn more →" now) **"See how it works →"**. Updated the EN and 中文
i18n entries too.

### 10. Hero tagline spacing — Already correct
The hero `<h1>` is built from spaced `word-animate` spans with `<br>` line breaks
and renders correctly as three lines: **"Your resume, / perfectly tailored / to
every job."** No missing spaces — verified in the rendered page.

## Verification performed
- `node server.js` → HTTP 200; each fix confirmed against `curl` output.
- All inline JS blocks syntax-checked (0 errors).
- Bilingual heading indices re-checked: `.section-title[8]`=Pricing,
  `[9]`=FAQ; `.section-eyebrow[7]`=Pricing, `[8]`=Common Questions — all aligned.
- Dynamic date confirmed to render today's date via `stampDates()`.
