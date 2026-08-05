# Mobile Contrast — Round 3

Branch **`claude/mobile-contrast-round3`** → PR. Suite (21 files) green. Mobile-scoped only; desktop untouched.

## 1 — Site-wide faded headings/titles on cream background

**Root cause, part A (the big one):** dozens of shared SEO/tool pages were built for a dark theme and never fully migrated. Two patterns made text disappear on the cream mobile background:
- **Gradient-clipped headings** — `background: linear-gradient(...); -webkit-background-clip: text; -webkit-text-fill-color: transparent;` renders near-white on a dark background but is basically invisible on cream.
- **Leftover light hex colors** (`#f1f5f9`, `#e2e8f0`, `#cbd5e1`, …) hardcoded in each page's own `<style>` block or inline `style=`, dating from before the site's cream/forest-green redesign.

**Fix (`public/theme.css`, mobile-only `@media (max-width: 820px)` block, shared by ~277 pages):**
- Every `h1`–`h4` (and their coloured `span`s), `.faq-q`, and anything with `title`/`heading`/`headline` in its class name is forced to solid `#1a1a1a` on mobile, with the gradient/clip killed.
- Inline `style="color:#e2e8f0"` etc. (the legacy dark-theme hex values) are darkened to `#2d2d2d`.

**Root cause, part B (why some elements were still faded after that):** `theme.css`'s `[style*="…"]` selectors only catch **inline** `style=` attributes — they can't reach colors set by a page's own **class rule** in a `<style>` block (e.g. `score.html`'s `.input-label { color: #e2e8f0 }`). Those needed page-scoped fixes since the same class name means something different on other pages (e.g. `.score-pct` is a plain near-white number on `score.html`, but a red/amber/green *status* color on `free-ats-resume-checker.html` — a shared rule would have wrecked that one).

Fixed directly in each page's own mobile media query:

| Page | Classes fixed |
|---|---|
| `score.html` (Optimization Hub) | `.input-label`, `.tab-btn`, `.tab-btn.active`, `.score-pct`, `.metric-value` |
| `ats-score-checker.html` | `.score-pct`, `.textarea-label` |
| `resume-analyzer.html` | `.textarea-label` |
| `free-ats-resume-checker.html` | `.ats-big-label`, `.score-label` |
| `tools/ats-keyword-extractor.html` | `.input-label` |
| `ai-resume-tailor.html` | `.stat-callout .big-num` (gradient stat number), `.big-label` |

The "Got missing keywords? Fix them in 30 seconds." card and the FAQ headings on `score.html` were already inline `#f1f5f9`/h2 tags, so they're covered by the shared `theme.css` rule above — no page-specific fix needed there.

I spot-checked `blog/index.html` and a sample generated role page (`software-engineer-resume.html`) — both are already fully covered by the shared rule (their prominent text is either an `h1`–`h3` tag, `.faq-q`, or a `-title`/`-heading` class). The ~277 generated role/cover-letter pages share one template and follow that same pattern, so I didn't find anything left to fix there.

## 2 — Optimization Hub title off-center

Checked `score.html`'s `.hero` — it's `text-align: center` already, and the title markup has no width/float that would pull it off-center. This was almost certainly the **contrast bug in disguise**: "Resume" was near-invisible white and "Optimization Hub" was a barely-visible gradient, so the visible fragments read as randomly placed rather than as one centered line. With #1's fix making both solid dark text, the title should now render as a normal centered heading. No separate centering CSS was needed — flag it again if it still looks off after the contrast fix lands.

## 3 — "Tailor My Resume Free" button overlapping body text (how-it-works.html)

**Root cause:** `.nav-inner` is a `display:flex` row with a **fixed `height: 64px`** and no wrap allowance, holding the logo + the full-length CTA button. `how-it-works.html`'s nav is simpler than the other tool pages (just logo + one button, no hamburger/link list), so it never got a mobile treatment at all — there was no mobile media query for `.nav`/`.nav-inner`/`.logo`/`.btn` whatsoever. On a narrow phone, the logo + "Tailor My Resume Free →" don't fit one line; the button wraps to two lines, grows taller than the fixed 64px row, and — since nothing clips it — spills out of the sticky nav on top of the hero heading directly below.

**Fix (mobile-only):** let the row size to its content instead of clipping (`height: auto; min-height: 64px; flex-wrap: wrap;`), and shrink the button/logo slightly so they fit on one line on most phones. Desktop nav is untouched (fixed 64px, no wrap).

## Files
`public/theme.css`, `public/score.html`, `public/ats-score-checker.html`, `public/resume-analyzer.html`, `public/free-ats-resume-checker.html`, `public/tools/ats-keyword-extractor.html`, `public/ai-resume-tailor.html`, `public/how-it-works.html`.

## Please verify on your phone
1. Blog index, `how-it-works`, `score` (Optimization Hub), `ats-score-checker`, `resume-analyzer`, `free-ats-resume-checker`, and the ATS keyword extractor tool — headings/titles/labels/FAQ text should all read as solid dark text on the cream background, no faded-white anywhere.
2. `score.html` — "Resume Optimization Hub" title reads centered.
3. `how-it-works.html` — scroll down; the "Tailor My Resume Free" nav button should stay inside the sticky bar, never overlapping the heading below it.

Desktop should look exactly as it did before this PR on every page above.
