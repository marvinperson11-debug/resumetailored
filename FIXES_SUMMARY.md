# Fixes: sitemap, llms.txt blog URLs, pricing sync

**Repo:** `marvinperson11-debug/resumetailored`
**Branch:** `claude/resumetailored-sitemap-blog-pricing-x89mpv`
**Commit:** `c8db2b1` — *Fix sitemap serving, llms.txt blog URLs, and pricing sync*
**PR:** [#418 (draft)](https://github.com/marvinperson11-debug/resumetailored/pull/418) · `mergeable_state: clean` · Netlify preview ✅
**Date:** 2026-08-30

---

## 1. Sitemap — `/sitemap.xml`

**Investigation.** The sitemap is a **static file** (`public/sitemap.xml`), not
dynamically generated — there is no Next.js/Astro/framework generator, no build
script, and no other route that produces it. It is valid, well-formed XML with
**333 URLs**, and it already includes **all 272 role/seniority landing pages**
(verified `/software-engineer-resume`, `/product-manager-cover-letter`,
`/registered-nurse-resume`, `/lead-sales-manager-cover-letter`, etc.). It served
`200 application/xml` locally.

The weakness: it was reachable **only** via `express.static`, sitting *behind*
the `app.get(/.*/)` HTML catch-all route and downstream of any CDN handling of
static extensions — a fragile path that can surface as a 500 in production.

**Fix.** Added an explicit, hardened `/sitemap.xml` route in `server.js`,
registered **before** the HTML catch-all and `express.static`:

- Always returns the file with the correct `application/xml; charset=utf-8`
  content-type.
- Independent of static-file resolution order and CDN quirks.
- If the file is ever missing from a deploy, it falls back to a **404**, never an
  unhandled **500**.

**Verified:** `HTTP 200`, well-formed XML, 333 `<loc>` entries, all sampled role
pages present.

---

## 2. Blog URLs in `llms.txt`

**Investigation.** The 22 blog links used raw `.md` **source** URLs, e.g.
`/blog/how-to-beat-ats-filters.md`. Those resolve to raw markdown
(`Content-Type: text/markdown`), not a rendered page. The public-facing URL is
the extension-less **clean URL** (`/blog/<slug>`), which serves the rendered
`200 text/html` article. (`.html` URLs 301-redirect to the same clean URL.)

**Fix.** Rewrote all 22 blog links in `public/llms.txt` from
`/blog/<slug>.md` → `/blog/<slug>`.

**Verified:** every one of the 22 clean URLs returns `200 text/html`.

---

## 3. Pricing sync

**Investigation.** The homepage serves **`$19.00/mo`**. `server.js` normalizes
**every** HTML page to `$19.00` at serve time (the `19.99 → 19.00` replacement in
`_sendVersionedHtml`, whose comment states Stripe charges exactly `$19.00`). The
static `llms.txt` **bypasses** that normalization (it's served as a static file),
so it was the lone surface still showing `$19.99`.

**Decision.** You confirmed **$19.00** is the source of truth (what the live site
serves and what Stripe charges).

**Fix.**
- `public/llms.txt`: aligned all 3 price mentions to `$19.00`, and bumped the
  `Last updated` date to `2026-08-30`.
- `test/llms-txt.js`: updated the assertion that hardcoded `$19.99` to expect
  `$19.00` (it was the reason the suite went red after the copy change).

**Verified:** homepage and `llms.txt` both serve `$19.00`; full `test/*.js` suite
passes, including the updated `test/llms-txt.js`.

---

## Files changed

| File | Change |
|---|---|
| `server.js` | New explicit, hardened `/sitemap.xml` route (+22 lines) |
| `public/llms.txt` | 22 blog `.md` → clean URLs; `$19.99` → `$19.00`; date bump |
| `test/llms-txt.js` | Price assertion updated to `$19.00` |

Diff stat: **3 files, +50 / −28**.

---

## Verification performed

- Booted the server locally (`node server.js`) and exercised each fix end-to-end:
  - `/sitemap.xml` → 200, well-formed XML, 333 URLs, role pages present.
  - All 22 blog clean URLs → `200 text/html`.
  - Homepage vs `llms.txt` price parity → both `$19.00`.
- Ran the full `test/*.js` suite → green.
- PR #418 opened as draft, `mergeable_state: clean`, Netlify deploy preview ✅,
  no CI failures, no review threads.

---

## Open note (not changed here)

The codebase is internally inconsistent on price: `CLAUDE.md`, the
`scripts/migrate-pricing-copy.js` migration, and ~326 static HTML files say
**$19.99**, while the live site + Stripe use **$19.00** (via the `server.js`
rewrite). This PR aligns `llms.txt` to the *served* price. Moving the whole
product to $19.99 instead would be a separate, larger change (remove the rewrite,
fix the 4 hardcoded-`$19.00` files, update docs) — available on request.
