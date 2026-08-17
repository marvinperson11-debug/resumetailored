# Website Creator + Landing Page fixes

Branch: `claude/website-creator-landing-fixes-i6zh77`

Four changes, in the requested priority order. Every fix was reproduced and
verified in real Chromium (desktop **and** mobile viewports), not just read.

---

## 1. Website Creator — blank white screen (CRITICAL) ✅

**Symptom:** clicking the **Website** tab rendered a completely blank white
screen — no spinner, no error, no modal.

**Root cause (traced, not guessed).** I drove the real bottom-nav flow
(`#tab-website` → `openWebsiteCreator()` → `showTab('website')` →
`loadWebsiteCreator()` → `wcOpenPicker()`) in a headless browser and measured
the editor shell's geometry. The shell rendered with **height = 0**:

```
shellRect: { w: 872, h: 0 }        ← 0-height = blank screen
shellPosition: "fixed"
shellOffsetParent: "panel-website" ← a fixed element should escape to the viewport
```

The Aug-2026 dashboard performance refactor added, in `public/css/app.css`:

```css
.tab-content { contain: layout paint; content-visibility: auto; ... }
```

`contain: layout` makes an element the **containing block for its
`position: fixed` descendants**. The Website editor shell (`.cv-shell`) is
`position: fixed; inset: 0` and expects to fill the *viewport*. Once
`#panel-website` (a `.tab-content`) became its containing block, `inset: 0`
resolved against the panel instead — and the panel's only child is the
out-of-flow shell, so the panel is **0px tall**. `inset: 0` against a 0-height
box → a 0-height shell → blank screen. Every other tab was fine because only
this one relies on a full-screen fixed child.

**Fix** (`public/css/app.css`): exempt the one panel that needs a viewport-fixed
child from containment (ID specificity beats `.tab-content.active`, no
`!important` needed):

```css
#panel-website { contain: none; content-visibility: visible; contain-intrinsic-size: auto; }
```

**Verified:** shell height `0 → 900px`; the template gallery (12 tiles) now
renders at both 1440px and 390px. The canonical browser test
(`test/browser/editor.js`) goes from *timing out on the blank screen* to
`ALL PASS (0 failures)`.

**Bonus fix uncovered by the same work** (`public/app.html`,
`edPositionInspector`): the floating properties-panel (the gear inspector) was
landing ~240px off the right edge of the screen. It is `position: fixed` but
`.cv-shell` carries `contain: layout paint`, so the shell — not the viewport —
is its containing block; the viewport-space coordinates were applied relative to
the shell's own left offset. Now converted to the containing block's coordinate
space (`- offsetParent.rect`). This was a latent bug the blank screen was
hiding; with the editor reachable again it mattered, and the two editor-test
checks for it now pass.

**Empty-state:** the "Tailor a resume first" gate (`openWcGate` / `wcGateModal`)
was already correct and still fires when the user has no saved assets — the
blank screen was never the empty state, it was the containment bug above.

---

## 2. Landing page lazy / janky rendering ✅

**Symptom:** content renders slowly as you scroll, starting at *"Which job
boards does ResumeTailored AI support?"* — often need to scroll back and forth
for it to appear.

**Root cause (measured).** Every `main > section` uses
`content-visibility: auto` with `contain-intrinsic-size` fallbacks. Those
fallbacks were measured at the **412px mobile viewport** (I confirmed they match
mobile heights almost exactly). On desktop, sections lay out much *shorter*
(wider columns, fewer wrapped lines), so the mobile fallbacks massively
**over-reserve** space:

| section | desktop real | reserved (mobile value) |
|---|---|---|
| `#features` | ~5,430px | 9,840px |
| `#job-boards` | ~726px | 1,460px |
| `#tiers` | ~1,022px | 2,255px |

`content-visibility` paints that oversized placeholder for each below-the-fold
section, then collapses it to the real height the instant the section renders on
scroll — so content jumps upward as you approach it and can flash blank first.
Measured total phantom reserved space on a 1440px desktop: **+7,014px** of
blank space that collapses as you scroll (it began at `#job-boards`, the first
fully-below-the-fold section — exactly as reported).

**Fix** (`public/index.html`): add a `@media (min-width: 901px)` block with
desktop-measured `contain-intrinsic-size` fallbacks; keep the (correct) mobile
values as the default. `content-visibility`'s `auto` keyword still self-corrects
to each section's real height after first paint.

**Verified:** phantom reserved-but-blank space on desktop dropped from
**7,014px → 1,264px** (−82%); the first scroll-through is essentially
shift-free. Mobile behaviour is unchanged. Homepage tests
(`homepage-content-visibility`, `homepage-ui-bugs`, `homepage-a11y`,
`homepage-console-clean`) all still pass.

---

## 3. CTA button: "See how it works" → "Start hiring" ✅

**Changed** (`public/index.html`, hero CTA): the secondary hero button now reads
**🏢 Start hiring**.

- **Icon:** the 🏢 building emoji — the same icon the Employer Portal feature
  card already uses on the homepage.
- **Styling:** a new `.btn-hire` class in the page's dark-navy **employer**
  colour (`#0f172a` — the exact colour the "For Employers" promo card and its
  CTA already use), deliberately *not* the green job-seeker accent, so an
  employer spots their button at a glance and the two hero CTAs read as two
  audiences. High-contrast and impossible to miss.
- **Link behaviour:**
  - **Logged-out / new visitors →** `/for-employers` (the same employer landing
    page the hamburger "For Employers" link uses).
  - **Signed-in visitors →** upgraded to `/employer` (the employer dashboard),
    skipping the marketing page. This reuses the page's existing auth-aware
    script (`/api/auth/me`); the href only flips after the session validates, so
    logged-out visitors always keep the marketing link. **This is the documented
    choice** for authenticated users.
- **i18n:** the Chinese translation entry was updated (**🏢开始招聘**) and keeps
  the icon across language toggles.

**Verified:** logged-out → `/for-employers`, dark-navy, icon present; Chinese
toggle → "🏢开始招聘" (icon preserved); logged-in (seeded session) → `/employer`.

---

## 4. Comparison card on the employer landing page ✅

**Added** (`public/for-employers.html`): a **ResumeTailored vs. traditional job
boards** comparison card, placed **immediately after the hero** (one of the
first things an employer sees), before the feature grid.

- **Competitors shown:** Indeed, ZipRecruiter, Monster, CareerBuilder,
  Glassdoor — each as a clean text wordmark in its real name and public brand
  colour.
- **Logos — the honest choice.** Per the task's stated fallback ("use text-only
  names… but try real logos first"), I used **real company names as
  brand-coloured text wordmarks** rather than (a) hot-linking external logo
  files — fragile, and a trademark/CSP risk on a served page whose only external
  asset is Google Fonts — or (b) hand-writing SVG paths, which would be
  *inaccurate* logos, i.e. exactly the "fake logos" the task forbids. The names
  are real, not placeholder text.
- **Framing — kept factual.** The right column characterises the *traditional
  job-board model* as a category (the five are named as examples of it) rather
  than making specific per-company claims that could be false (e.g. some boards
  do have limited AI/ATS features). This keeps every claim defensible.
- **Differentiators** (derived from the page's own tone): AI-ranked applicants,
  built-in hiring pipeline/ATS, free to start, flat predictable pricing, and
  candidates arriving with AI-tailored resumes.
- **Design:** uses the page's existing tokens (cream/forest, Fraunces serif
  heading, rounded cards); the ResumeTailored column is highlighted in a forest
  tint with checkmarks. Responsive — `table-layout: fixed` so it never causes
  horizontal scroll on a phone (verified no overflow at 390px).

---

## Verification summary

- `test/browser/editor.js` (real Chromium, 1440px + 390px): **ALL PASS** — was
  previously un-runnable (timed out on the blank screen).
- Full `test/*.js` suite: **no failures.**
- Landing-page phantom reserve: **7,014px → 1,264px** on desktop.
- Tasks 3 & 4 verified in-browser (button states + i18n; card layout + no
  mobile overflow).

## Files changed

- `public/css/app.css` — Task 1 (containment exemption).
- `public/app.html` — Task 1 (floating-inspector coordinate fix).
- `public/index.html` — Task 2 (desktop intrinsic sizes) + Task 3 (CTA button,
  style, i18n, auth-aware href).
- `public/for-employers.html` — Task 4 (comparison card).
