# Site Audit & Cleanup — Task Summary

Date: 2026-08-08. Branch: `claude/free-tools-page-redesign-6h2rab`.
All changes are frontend (`public/`), committed in logical phases. No server-side
logic changed.

---

## 1. Old purple → brand green ✅ done

**Found:** the pre-rebrand accent — indigo `#6366F1` / violet `#8B5CF6` and its
whole Tailwind ramp (`#818cf8`, `#a5b4fc`, `#c7d2fe`, `#4338ca`, `#7c3aed`,
`#4f46e5`, `#6d28d9`, …) plus `rgba(99,102,241,…)` and indigo tints — in **~4,300
places across 337 files**. On most SEO pages `theme.css` masked it to green with
`!important`, but it leaked wherever that override didn't reach — most visibly the
`app.html` editor (which loads `app-theme.css`, only a curated subset).

**Fixed:** replaced the legacy palette at the source with the brand green system
(`#1F5C3D` / `#2E7D53` / `#153F2A` + tints) in all HTML/CSS/JS, so nothing relies
on override CSS anymore. Covers badges, buttons, nav, links, borders, gradients,
focus/hover states, editor chrome, blog and SEO pages — desktop and mobile.

**Deliberately preserved (not brand-chrome leakage — flag if you disagree):**
- `site-vibes.js` — the personal-website "vibe" themes (Calm/Bright/Dark/Colorful…)
  are an intentional multi-color palette users pick from.
- `OUT_TPLS` "Modern Violet / Bold Violet" resume templates and the
  `.tpl-modern` / `.tpl-elegant` template accents in `style.css` — these are
  template identities, not the old brand color.
- Website-builder default/placeholder swatches in `app.html`.

**Intentionally skipped (brand art — recolor on request):** `public/ads/*.svg`,
`public/flyers/*.html`, `public/blog/og/*.html` (share-image templates), and
third-party `public/vendor/*`.

---

## 2. LinkedIn card → wrong destination ✅ fixed

**Found:** the LinkedIn Optimizer is a tab *inside* the dashboard
(`showTab('linkedin')`) with no standalone URL, and `app.html` had no way to
deep-link a tab — so every "Optimize My LinkedIn" entry point
(`window.location='/dashboard'`) landed on the default **Tailor / Resume Creator**
tab. That's the bug you reported.

**Fixed:** added a `?tab=` deep-link handler to the app boot (allow-listed tabs,
preserves `?lang=`). Repointed every LinkedIn entry point — homepage button,
`zh/index.html`, and the Free Tools card — at `/dashboard?tab=linkedin`. Also
enables `?tab=video` / `?tab=website` used by the new Pro hub.

---

## 3. Free Tools page = cards only ✅ done

**Found:** `/score` opened the ATS Match and Readability tools inline.

**Fixed:** `/score` is now a **cards-only hub**. It leads with the tool cards;
each links to that tool's own page:
- ATS Score Checker → `/ats-score-checker`
- Readability Review → `/resume-analyzer`
- Keyword Extractor → `/tools/ats-keyword-extractor`
- Resume Tailor / Cover Letter / Share-as-Link → `/dashboard`
- LinkedIn Optimizer → `/dashboard?tab=linkedin`
- Resume / Cover-letter Examples → `/resume-examples`, `/cover-letter-examples`

Removed the inline tool UI and its now-dead JS; kept the FAQ/AEO content (moved
below the cards) and reworded the hero + title/meta for a tools hub. EN + ZH copy
updated together.

> **SEO note (your call):** `/score` previously ranked as an ATS tool page with
> `WebApplication`/`FAQPage` schema. As a hub it now overlaps `/ats-score-checker`
> for the same keyword. I kept the page's canonical + schema and its FAQ content
> to preserve ranking signals, but if you'd rather **not** repurpose `/score`, the
> alternative is to leave `/score` as the tool and stand up a separate
> `/free-tools` hub. Say the word and I'll switch.

---

## 4. Paid Tools page = cards only ✅ done (new page)

There was no "Paid Tools" page — only a marketing section on the homepage. Created
**`/pro-tools`** (`public/pro-tools.html`): a bilingual cards-only hub mirroring
the Free Tools layout, with cards for Resume Video Maker, Personal Website Builder,
Career Hub, Premium Templates, and the Employer Portal — each linking straight to
its tool (`/dashboard?tab=video`, `/dashboard?tab=website`, `/dashboard`,
`/employer`). Nav ("Pro Tools") now points to `/pro-tools` (in `site-nav.js` and
the homepage nav); the homepage `#pro-tools` marketing section stays. Added to
`sitemap.xml`.

---

## 5. Chinese translations — ⚠️ partially done

- ✅ **Free Tools hub (`/score`)** and **Pro Tools hub (`/pro-tools`)** are fully
  bilingual (every string has an EN + Simplified-Chinese `data-i18n` entry).
- ⚠️ **Still English-only (documented backlog, needs your input):**
  - Homepage Free/Pro **feature cards** (`index.html` translates via a
    selector-map that doesn't cover these newer cards).
  - App **"What's New" promo panel** and a few app buttons (e.g. the tailor
    "Fetch") are hardcoded, not routed through `APP_I18N`/`_t()`.
  - **Employer Portal** (`/employer`) is English-only.
  - SEO pages have **no on-page language toggle** — `site-nav.js` replaces each
    page's nav (and its toggle), so Chinese only shows if `rt_lang` was set
    earlier on the homepage. This is likely why you saw English on a tool page.

  **Decision needed (Q3):** should Chinese be served **in-place** (add
  `data-i18n` + a dictionary to each English page — one page to maintain) or via
  the **separate `/zh/` pages** (then the in-place toggle should redirect there)?
  The answer determines where the remaining translations go; I held off on a
  large partial pass that could ship mixed-language pages.

---

## 6. Full walkthrough

**Verified statically (in-repo):**
- ✅ All hub-card and nav targets resolve to real files/routes — no 404s
  (`/ats-score-checker`, `/resume-analyzer`, `/tools/ats-keyword-extractor`,
  `/resume-examples`, `/cover-letter-examples`, `/employer`, `/pro-tools`,
  `/score`, `/how-it-works`, `/blog`, `/dashboard`).
- ✅ No old purple anywhere in code except the deliberately-preserved design
  palette + skipped brand art.
- ✅ `/score` and `/pro-tools` markup is tag-balanced; no references to removed
  elements/functions; sitemap updated.
- ✅ LinkedIn and Pro-tool cards deep-link correctly.

**Could NOT verify at runtime here** (no `node_modules` / secrets in this
environment — needs a live deploy):
- Auth (Google/LinkedIn OAuth), Stripe checkout, Job Finder (needs `RAPIDAPI_KEY`),
  Employer Portal end-to-end flows, resume-video render. These depend on live
  keys/services; I verified their **links/wiring** statically only. Recommend a
  pass on the Netlify deploy preview / staging.

---

## Needs your input
1. **Q3 (Chinese strategy)** — in-place vs `/zh` — blocks finishing item 5.
2. **`/score` SEO** — keep it repurposed as the Free Tools hub, or spin up a
   separate `/free-tools` page and restore `/score` as the tool? (item 3)
3. **Brand art** — recolor the `flyers/`, `ads/`, and `blog/og/` purple too, or
   leave those images as-is?
4. **Resume-template palettes** — I preserved the "Violet" templates and
   `.tpl-modern/.tpl-elegant` accents; confirm you want those kept (vs. forced
   green "no exceptions").
