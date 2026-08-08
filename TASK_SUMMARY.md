# Chinese i18n + universal language toggle — Task Summary

Date: 2026-08-08. Branch: `claude/free-tools-page-redesign-6h2rab`.
Follows the merged audit PR #355 (color cleanup, LinkedIn deep-link, Free/Pro
hubs). This PR delivers your answers to **Q3 (both Chinese paths)** and
**Q5 (language toggle on every page)**. Q1/Q2 already shipped in #355.

---

## Q5 — universal language toggle ✅

**`site-nav.js` now carries a 中文/EN toggle.** Because that script injects the
canonical nav on **every** marketing / SEO / blog / tool page, the toggle now
appears site-wide from one change. Clicking it:
- persists `rt_lang` (global preference — carries across pages),
- translates the injected nav (links, Log In, CTA) via a built-in EN/中文 dict,
- calls the page's own `window.applyLang(lang)` when it has one (e.g. `/score`,
  `/pro-tools`) so the page **body** switches too. The button uses
  `id="langToggleBtn"`, which those pages' own translators also target, so
  everything stays in sync.

**Pages with their own nav** (not `site-nav.js`) each have the toggle too:
- `index.html` — already had a full toggle (kept, and extended below).
- `app.html` (dashboard) — already had a toggle.
- `employer.html` — **added** a toggle: it translates the portal's public nav
  and persists the shared preference. (Deep translation of the portal's app UI
  is a tracked follow-up — see below.)

---

## Q3 — both Chinese paths ✅ (with one honest caveat)

**In-place homepage toggle** — the homepage already translated most content via
its `data-i18n` + `TRANS` engine. I closed the two remaining untranslated
feature cards — **ATS Match Score Scanner** and **Employer Portal** (heading,
description, bullets, CTA) — using **`data-i18n`** (position-independent), on
purpose: the `TRANS` map is index-based and its own comments document past
content-corruption from index drift, so I avoided it. Toggling EN↔中文 on the
homepage now leaves nothing English in those cards.

**`/zh/index.html`** — added the **Pro Tools** nav link (desktop + mobile) and
the `nav_pro_tools` dictionary entry so its nav matches the current site.

> **Caveat you should know:** `/zh/index.html` is an **older, simpler** copy of
> the homepage — it predates several sections the English page has since gained
> (Employer card, Resume Video, Personal Website, Career Hub, the ATS-scanner
> card). Bringing it to full visual parity is a sizeable content rebuild.
> **Good news:** it's now arguably redundant — the in-place toggle on the
> English homepage translates *everything*, so a Chinese visitor gets the full,
> current homepage in Chinese from `/`. My recommendation is to either (a)
> **redirect `/zh/` → `/` and set `rt_lang=zh`**, or (b) schedule a rebuild of
> `/zh/index.html` from the current homepage. Tell me which and I'll do it.

---

## The long-tail reality (unchanged from my earlier note)

The **277 generated SEO role pages** (`*-resume` / `*-cover-letter`) and **most
blog posts** have **no Chinese dictionary** — only `/zh/index.html` and a couple
of `/zh/blog` pages exist. With this PR the **toggle is present on them, the
shared nav switches to Chinese, and the preference is stored**, but their
**body copy stays English** because the Chinese text doesn't exist yet.
Translating hundreds of unique templated pages is a separate job best done by
**generating `/zh/` variants from the role dataset + AI translation** (needs the
Anthropic key at build). I did not fabricate those translations. Say the word
and I'll scope that generator as its own PR.

**Fully bilingual now:** homepage, `/score`, `/pro-tools`, the app dashboard,
the Employer Portal nav, and the shared nav on every page.
**Nav-only + preference:** the SEO role pages and long-tail blog.

---

## Verification
- ✅ `site-nav.js` parses; toggle wired on desktop + mobile; `id="langToggleBtn"`
  shared with tool-page translators.
- ✅ Homepage: 15 new `data-i18n` hooks on the two cards; matching EN + 中文 dict
  entries (2× each key).
- ✅ `employer.html` toggle script parses; nav links carry `data-emi` hooks.
- ✅ `/zh/index.html` nav + dict updated.
- ⚠️ **Could not run the app** (no `node_modules`/secrets here) — changes are
  static HTML/JS verified by inspection + `node -c`. Recommend a click-through on
  the Netlify deploy preview (toggle on `/score`, `/pro-tools`, a role page, the
  homepage cards, and the employer nav).

## Still needs your input
1. `/zh/index.html`: redirect to `/` (recommended) **or** rebuild to full parity?
2. Translate the SEO/blog long tail (generate `/zh/` variants)? — separate PR.
