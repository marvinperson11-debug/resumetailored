# llms.txt — implemented

## 1. Main platform `llms.txt`

You already had a `public/llms.txt` from an earlier round — it was in good shape (correct format, real pages) but had gone stale on two facts since the 2026 pricing change:

- Said the free tier was capped at "1 tailoring/day" → now says it's genuinely unlimited.
- Said Pro was "$19/month" → now says the correct **$19.99/month** (and $129 lifetime), in three places.
- Added the required `<!-- Last updated: 2026-08-02 -->` comment at the top.
- Added a bullet about the personal-website feature (it wasn't mentioned anywhere before).

Everything else — the resource pages, all 70+ role examples, the blog posts, the competitor comparisons — was already accurate and real (I checked every link category against the actual files on disk), so I left it in place rather than rewriting it from scratch.

## 2. Auto-generated `llms.txt` for published personal websites

**One thing to flag before the details:** your spec said "write the auto-generated llms.txt to the deploy directory alongside index.html." There is no such directory in this codebase — personal websites aren't built to static files at all. Every page (`/site/alice`, `/site/alice/work`, …) is rendered **fresh from the database on every request** (`_renderPersonalSite`/`_serveSite` in `server.js`). So I translated the intent onto the real architecture: `llms.txt` is generated the same way every other page on the site is — on request, from the live `personal_sites` row — rather than written to disk once at publish time. This is actually *better* than a static file here: it can never go stale relative to a site that keeps autosaving after the last publish (a written-once file would silently drift the moment the user edited a page afterward).

**New file: `llms-txt.js`** — the reusable builder, exactly as requested:

```js
generateLlmsTxt({ name, tagline, pages: [{ title, url, description }] })
```

Pure function, no database access, so it's independently testable and reusable from anywhere (the route, a script, a test).

**In `server.js`:** `_siteLlmsTxtData(row, origin)` adapts a `personal_sites` row into that shape:
- H1 = the person's name (falls back to their subdomain).
- Blockquote = the home page's own SEO description if they wrote one (their chosen pitch), else a summary pulled from their résumé via the same `deriveFields()` the site itself already uses, else a generic sentence.
- Each page in their site (`Home`, `Work`, `Contact`, …) becomes one `- [Title](url): description` line, using each page's own SEO title/description where set.
- A published cover letter gets its own linked entry.

**Routes** (mirrors how `/site/:sub/cover-letter` already works):
- `GET /site/:sub/llms.txt` — path-based.
- `GET /llms.txt` on `<sub>.resumetailored.com` — the host-based subdomain equivalent, once that DNS/TLS is live.

Both are gated exactly like the rest of the site: a **draft** (unpublished) site's `llms.txt` 404s, same as the page itself. A renamed address 301s its old `llms.txt` to the new one.

## 3. `robots.txt`

Added, since it already existed:
```
Sitemap: https://resumetailored.com/llms.txt
```
(kept your existing `sitemap.xml` line alongside it, didn't touch anything else).

## 4. Maintainability

- `generateLlmsTxt(siteData)` is the one reusable function, callable from the route or a test without any server/DB setup.
- The platform `llms.txt` carries its own last-updated comment for hand-maintenance.

## Verification

New test file `test/llms-txt.js` (33 checks, all passing) covers:
- The pure builder's Markdown output shape (H1/blockquote/link format, missing-description and missing-url edge cases).
- The platform file's format and that it no longer advertises the old capped free tier or the old price.
- `robots.txt` referencing it.
- A live server: draft sites 404, published sites serve real content, per-page descriptions, the cover letter link, the host-based subdomain form, and the rename-redirect case.

Full suite (`test/*.js`) still 0 failures.

## Try it

```
GET /llms.txt                    → the platform index
GET /site/<your-subdomain>/llms.txt   → once you've published a personal site
```
