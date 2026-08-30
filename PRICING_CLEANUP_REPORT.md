# Pricing cleanup report — `$19.99` → `$19.00`, rewrite removed

**Repo:** `marvinperson11-debug/resumetailored`
**Branch:** `claude/resumetailored-sitemap-blog-pricing-x89mpv` (restarted from latest `main`)
**Commit:** `d858ca0`
**PR:** [#419 (draft)](https://github.com/marvinperson11-debug/resumetailored/pull/419)
**Date:** 2026-08-30

---

## (a) How many files were changed

**348 files changed** (`+1084 / −1088`):

- **347 files** — bulk `$19.99` → `$19.00` replacement (pricing copy).
- **1 file** — `server.js` — removed the runtime rewrite.

Breakdown of the 347 copy files:

| Group | What |
|---|---|
| SEO role pages | every `*-resume.html` / `*-cover-letter.html` base role page + entry-level / senior / lead seniority variants |
| Hub & comparison | `resume-examples`, `cover-letter-examples`, `alternatives/*`, `*-alternative.html`, `claude-vs-chatgpt-for-resumes`, etc. |
| Tools | `tools/*.html` (ats-keyword-extractor, follow-up-generator, offer-comparison, salary-negotiation, resume-ab-tracker, job-description-decoder) |
| Blog | each post's `.html` **and** its `.md` source |
| Bilingual | `zh/index.html`, `zh/english-resume.html` (incl. `¥19.99/月` → `¥19.00/月`) |
| Marketing assets | `flyers/*`, `panels/*`, `assets/banners/linkedin/square-bold.html` |
| Misc pages | `how-it-works`, `terms`, `cancel`, `pro-tools`, `resume-analyzer`, `ats-score-checker`, `free-ats-resume-checker`, … |
| Docs | `CLAUDE.md`, `PLAN.md`, `CAREER_HUB_PLAN.md`, `EMPLOYER_PORTAL_PLAN.md`, `PROJECT_HANDOFF.md`, `docs/*.md` |
| Scripts | `scripts/migrate-pricing-copy.js` (target literals set to current price) |

All price forms were covered uniformly: `$19.99/mo`, `$19.99/month`, the JSON‑LD `"price":"19.99"` offers, the CNY `¥19.99/月`, and `$19.99 tool` marketing mentions.

### server.js — rewrite removed
Deleted from `_sendVersionedHtml`:
```js
// One canonical public price across legacy SEO pages and freshly-built
// ecosystem pages. This avoids stale long-tail copy advertising $19.99
// while Stripe and the membership architecture use exactly $19.00.
html = html.split('19.99').join('19.00');
```
Pages now serve `$19.00` natively.

---

## (b) Do tests pass?

**Yes — full `test/*.js` suite passes: 62 files, 0 failures.**

Sanity check with the rewrite gone (dev server on `:3999`), `$19.99` count is **0** on every page:

| Page | `$19.00` | `$19.99` |
|---|---|---|
| `/` (homepage) | 36 | 0 |
| `/pricing` | 36 | 0 |
| `/software-engineer-resume` | 2 | 0 |
| `/product-manager-cover-letter` | 2 | 0 |
| `/alternatives/teal` | 4 | 0 |

Homepage JSON‑LD offer renders `"price": "19.00"`. Static `llms.txt` remains `$19.00` (fixed in the prior PR).

---

## (c) Edge cases found

1. **The runtime rewrite defined "served truth."** It did a blind substring replace `19.99`→`19.00` on all HTML. Replacing the same literal in source therefore makes the new native output **byte-identical** to what production already serves — a safe, no-visible-change refactor rather than a price change.

2. **CNY `¥19.99/月`.** The old rewrite blindly rewrote this to `¥19.00/月`, so production already served `¥19.00`; the source now matches. Note `¥19` is a localized/placeholder figure, **not** a currency conversion of $19 — flag for the business if the intended CNY price differs. (`scripts/migrate-pricing-copy.js` had historically left CNY untouched; the rewrite overrode that at serve time.)

3. **Two files intentionally keep `$19.99`:**
   - **`test/llms-txt.js`** — the assertion `platform.includes('$19.00') && !platform.includes('$19.99')` is a **regression guard**; it must reference the literal `$19.99` to assert its *absence*. Rewriting it would make the test assert against `$19.00` and break.
   - **`FIXES_SUMMARY.md`** — a historical narrative of the previous PR ("llms.txt still said $19.99", "~326 files say $19.99"). Those are accurate descriptions of past state; rewriting them would make the record false.

   A `grep -rn "19.99"` (excluding `node_modules`/`.git`) returns **only** these two files.

4. **`scripts/migrate-pricing-copy.js`** is a one-off, already-run, idempotent migration (`$19` → current price). Its literals were updated so the repo carries no stale `$19.99`; it targets OLD strings, has already run, and does not re-run automatically, so the change is inert operationally.

5. **Branch had to be restarted.** The previous PR (#418) on this branch was already **merged**, so per the repo workflow the branch was reset onto the latest `main` (`2de4b1a`) and this cleanup pushed as a fresh commit (`force-with-lease` over already-merged history) → new PR #419, not a re-use of the merged one.

---

## Questions for you

1. **CNY price:** confirm `¥19.00/月` is the intended localized price (it now matches what the site already serves). If the real CNY price should be different, say the value and I'll set it.
2. **Deploy:** shall I mark #419 ready and merge, then let Railway auto-deploy `main` to production (same flow as #418)? Say the word.
3. **`FIXES_SUMMARY.md`:** keep it as a historical record, or delete it now that this cleanup supersedes its "open note"?
