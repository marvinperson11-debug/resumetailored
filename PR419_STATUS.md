# PR #419 — status: green & ready for your call

**PR:** [Make $19.00 the source-of-truth price; remove the runtime rewrite](https://github.com/marvinperson11-debug/resumetailored/pull/419) (draft)
**Repo / branch:** `marvinperson11-debug/resumetailored` · `claude/resumetailored-sitemap-blog-pricing-x89mpv`
**Head commit:** `9567c07` (base `main` = `2de4b1a`)
**As of:** 2026-08-30 09:09 UTC

---

## CI / checks

| Check | Type | Result |
|---|---|---|
| **`test`** (GitHub Actions) | required CI | ✅ **success** |
| Deploy Preview (`d858ca0`, pricing commit) | Netlify | ✅ ready — [preview](https://deploy-preview-419--mellow-macaron-463353.netlify.app) |
| Deploy Preview (`9567c07`, docs-only commit) | Netlify | ⚪ canceled (no site content changed — expected) |
| Redirect rules / Header rules / Pages changed | Netlify (informational) | ⚪ neutral |

**Mergeable state:** no conflict. The only reason it briefly read `unstable` was the `test` job running + Netlify's neutral/canceled informational checks — not a failure.

---

## What's in the PR

- **348 files changed** (`+1170 / −1088` over 2 commits).
  - 347 files: `$19.99` → `$19.00` across all pricing copy (SEO role/variant pages, hubs, `alternatives/*`, tools, blog `.html` + `.md`, `zh/` incl. `¥19.99/月`, flyers/panels/banner, `CLAUDE.md`, planning + `docs/*.md`, `scripts/migrate-pricing-copy.js`).
  - `server.js`: removed the `html.split('19.99').join('19.00')` runtime rewrite from `_sendVersionedHtml`.
- Two files intentionally still contain `$19.99`: `test/llms-txt.js` (regression guard asserting the string's absence) and `FIXES_SUMMARY.md` (historical narrative). A repo-wide grep returns only these two.

## Verification
- Full `test/*.js` suite: **62 files, 0 failures** (locally and in CI).
- Dev-server spot check with the rewrite gone: `/`, `/pricing`, and role pages render `$19.00`, zero `$19.99`; homepage JSON-LD offer = `"price": "19.00"`.

---

## Waiting on you (2 decisions)

1. **CNY price** — confirm `¥19.00/月` is intended (it now matches what the site already serves). If the real localized price differs, tell me the value and I'll set it.
2. **Ship it?** — say the word and I'll mark #419 ready, merge to `main`, and let Railway auto-deploy to production (same flow as #418). I'll verify the live site afterward.

No further action from me until you decide; the PR is being watched and I'll surface anything new.
