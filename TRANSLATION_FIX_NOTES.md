# Full-Site 中文 Translation — Audit & Fix

Branch: `claude/live-site-fixes-2ffkxa`.

## What was wrong

The site had **three** translation surfaces, and only two of them worked:

1. **Homepage** (`index.html`) — its own exhaustive `applyLang` (data-i18n + selector
   table + bulk rules). ✅ Fully translated.
2. **App dashboard** (`app.html`) — its own exhaustive `applyLangApp` driven by
   `public/js/i18n-data.js`. ✅ Fully translated.
3. **Everything else** — the ~300 SEO/role pages, the marketing/tool pages, the blog,
   the alternatives pages. These get the shared nav (`site-nav.js`), whose toggle
   **only translated the nav chrome** and then called `window.applyLang` *if the page
   defined one* — and none of these pages did. **So clicking 中文 there switched the
   nav and left the entire page body in English.** That is exactly the "only certain
   sections translate" the report describes.

Hand-authoring a Chinese dictionary for 300 unique pages is not maintainable, and it
would still miss the next page anyone adds.

## The fix — a generic, cached, full-DOM translator

A new shared translator that works on **any** page without per-page dictionaries.

### `public/site-i18n.js` (client)
- On switch to 中文 it walks the **entire DOM** — every visible text node **plus**
  `placeholder` / `title` / `aria-label` / `alt` attributes — collects the unique
  English strings, and swaps in the Chinese. Switching back to English restores the
  stored originals instantly (no network).
- **Chains** after a page's own `window.applyLang` when one exists (e.g. `/score`,
  `/pro-tools`, `/ats-score-checker`), so their curated translations run first and this
  fills in the rest.
- **Skips** what must not be touched: `script`/`style`/`code`/`pre`/`textarea`/`svg`,
  the self-translating nav (`#snav`, hamburger, role modal), the language toggles
  themselves, `.js-today`, and anything marked `[data-no-i18n]` / `.notranslate`.
  Skips strings that are pure numbers/symbols, emails, URLs, or already Chinese.
- **Persists across navigation**: if `rt_lang` is `zh`, a freshly loaded page
  auto-translates its body on load.

### `POST /api/i18n/translate` + `i18n_cache` table (server)
- Batch-translates the unique strings to Simplified Chinese via **Claude Haiku**,
  and **caches every result cross-user** in a new `i18n_cache` table keyed by
  `sha256(source)+lang`. So each unique phrase is billed **once for the whole user
  base**; every later request — every other visitor, every other page reusing the
  phrase — is a free DB read. The prompt keeps brand names (ResumeTailored, LinkedIn,
  ATS…), URLs, emails, placeholders (`{n}`), and leading/trailing emoji/arrows intact.
- **Fails open everywhere**: no `ANTHROPIC_API_KEY`, a network error, an unsupported
  language, or a malformed body all return whatever is cached (often nothing) and the
  client simply leaves those strings in English — a page never breaks.

### Injection
`_injectSiteI18n` adds the script to every page in the send pipeline **except** the
homepage (matched by resolved path, so directory `index.html` files like `/blog/`
are **not** wrongly excluded) and the three app shells (`app.html`, `employer.html`,
`portal.html`), which own their own systems.

### The login role modal
Already localized by `site-nav.js` (`setRoleLang`): the prompt renders as
*“您是以求职者还是雇主身份登录？”* with **求职者 / 雇主** — re-verified this round.

## Verification (headless Chromium, live server)

- **Full body translates** on `/software-engineer-resume` (62 fragments),
  `/ai-resume-tailor` (32), `/blog/` (158): H1s, body text, CTAs and buttons all swap;
  the toggle flips to **EN**; switching back restores English with **no residue**.
- **Login role modal** renders fully in Chinese.
- **Cross-page persistence**: loading a *new* page while in 中文 auto-translates it.
- **Server**: cache hit returns the seeded translation; uncached string is omitted
  (fail-open); unsupported language + malformed body return empty without erroring.

## Regression suite
- **New test `test/site-i18n.js`** (18 checks): endpoint cache-hit / fail-open /
  unsupported-lang / malformed-body, per-page injection (SEO + blog yes; homepage +
  app shell no), and the client contract (chaining, skip rules, attribute coverage,
  EN restore, load-time persistence).
- Updated `test/global-language-toggle.js` for the extended send pipeline.
- **61/61 green on Node 20** (the requested version) **and Node 22.**

## Known limitation (honest scope)
Text that is injected **after** a toggle (e.g. a dynamic error message rendered by a
later click) is translated only if it is present when 中文 is pressed or on the next
page load; the curated app/homepage translators still own their own dynamic strings.
This covers all static page content — headings, body, buttons, CTAs, tool
descriptions, form labels/placeholders, footers, and the login modal.
