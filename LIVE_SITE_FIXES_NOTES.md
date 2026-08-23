# Live Site Fixes — Working Notes & Questions

Branch: `claude/live-site-fixes-2ffkxa`

## Baseline
- Installed deps; regression suite: **57/58 pass**. The 1 "fail" (`test/audit-regressions.js`) is only the two ATS/LinkedIn subtests that need a live `ANTHROPIC_API_KEY` (absent in this sandbox) — pre-existing, unrelated to these fixes.

## Status by item

### ✅ 4. Chinese language toggle visibility — DONE (committed)
Root cause found and fixed in three places where the toggle blended into navy:
- `public/luxury-ecosystem.css` `.club-nav__lang` — used dark ink text on the navy nav → now white bg / navy text, emerald hover.
- `public/index.html` `#langToggleBtnFooter` — was a beige (`#E7DFD1`) chip → now white / navy palette.
- `public/top-language-toggle.js` global fallback — had a navy (`#0a1628`) background on navy pages → now white bg. (Its palette test still passes.)

Note: on all pages that use the shared injected nav (`#snav`, from `site-nav.js`), the toggle was already forced to visible cream — those were fine.

### 🟡 1. Color consistency — PARTIALLY in place, needs a scope decision
- Dashboards already use the **exact** requested palette via `public/dashboard-luxury-unified.css` (`#0a1628 / #1a4d3a / #c9a227 / #f5f1e8`). Job-seeker, employer, and corporate back-office surfaces are covered.
- **Remaining old-color offenders I can see:**
  - Homepage (`index.html`) still has the OLD stacked sections below the ecosystem redesign with light/beige backgrounds — e.g. `section-gray`, an inline `background:#F1EADD` band (~line 1271), the old pricing/whats-new sections.
  - `luxury-ecosystem.css` `.pillar-story` deliberately uses a **cream** panel (`--club-cream:#f7f1e6`).
  - The ~400 SEO role/landing pages (`*-resume.html`, `*-cover-letter.html`, `/alternatives/*`, blog, tool pages) are currently **light-themed marketing pages**.
- **Decision needed:** see Q1 below — the 400 SEO pages are the big fork.

### 🟡 2. Card-based layout — needs a scope decision
- The "long vertical newsfeed" is the stack of OLD full-width sections on `index.html` (features → job-boards → templates → tiers → whats-new → pricing → footer), sitting under the newer "ecosystem" hero/pillars/pricing.
- Converting these to a card grid is a real redesign of the homepage. I want to confirm exactly which surface and how far before touching it (see Q2).

### 🔴 3. Dashboard buttons not clickable — needs specifics
- Every `<button>` in the repo has a click/submit handler in source (`test/button-integrity.js` passes), so this isn't missing handlers.
- The palette overlay (`body:has(.dashboard)::before`) sets only `background` with no `content`, so it generates no box and does **not** block clicks — ruled out.
- I can't reproduce "dead buttons" from source alone. I need to know **which** buttons, on **which** dashboard (job-seeker `/app` vs employer), and desktop vs mobile (see Q3).

## Questions
- **Q1 (scope of color audit):** Do the ~400 light-themed SEO/marketing landing pages need the navy treatment too, or only the core app/dashboard/tool/login + homepage surfaces?
- **Q2 (card layout):** Should I convert the homepage's old stacked sections into a card grid (keeping content/links/Stripe CTAs identical), or is a different page the "newsfeed"?
- **Q3 (dead buttons):** Which specific buttons are dead, on which dashboard, and desktop or mobile?
