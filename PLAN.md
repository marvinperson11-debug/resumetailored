# Implementation Plan — Pricing Restructure + LinkedIn Import + Personal Websites

**Status:** ✅ Implemented (approved 2026-07-22). All seven steps below are built, tested, committed, and pushed on `claude/resumetailored-pricing-plan-iwy6un`. This file is retained as the design record. Open items still needing your input: the canonical **CNY (¥) price** (left unchanged site-wide) and the **ad-gate vs watermark** overlap on free downloads (see the PR summary).

This plan covers five changes:
1. Restructure the free tier (unlimited resumes/cover letters, watermarked, 3+3 basic templates).
2. Lock the rest of the template library behind Pro.
3. Add LinkedIn OAuth import (free).
4. Add a Pro-only personal portfolio website (`name.resumetailored.com`).
5. Update all site content to match.

---

## 0. Current-state facts I confirmed (so we're working from reality, not the docs)

| Thing | Reality in the code today |
|---|---|
| Free tier limit | `1 free per day per feature`, enforced in `server.js` `/api/tailor` (lines ~1966–1979) via `hasFreeTierLeft()` / `consumeFreeTier()` keyed `${usageKey}_${type}_${date}` in the `usage_store` table. |
| Template library | Defined **once** in `public/app.html` as `OUT_TPLS` (line ~3199): **56 resume** (`r1`–`r56`) across 7 base layouts, **48 cover** (`c1`–`c48`) across 6 base layouts. Each entry has a `free:true/false` flag. |
| Current free templates | Only **`r1` (Classic)** and **`c1` (Formal)** are `free:true`. Everything else is `free:false`. (Note: several marketing pages say "2 free templates" — that already doesn't match the 1+1 in code.) |
| Template gating | **Client-side only.** `renderTplPicker()` (line ~3490) computes `locked = !tpl.free && !isSubscriberFlag`. The **server does not verify** the chosen template on `/api/download-docx` or `/api/share` — a crafted request can use any template. This must change (see §2). |
| Pricing in code | `$19/mo` everywhere. ⚠️ Your brief says "current Pro price is **$19.99**/month." **Flagged — see Open Questions.** I will not change the price without your say-so. |
| Exports | **PDF** = client-side `window.print()` of generated HTML (`downloadPdf()`, app.html ~5149). **DOCX** = server-side `docx` library in `buildTemplatedDocxBuffer()` (server.js ~1102), assembled as `sections`. **Share link** = server-rendered HTML via `_shareResumeHtml()` (server.js ~1219), reachable at `/r/:slug`. |
| Video generator | `/api/resume-video` already **Pro-gated** (server.js ~2337). No change needed except confirming free tier gets 0. |
| Existing "LinkedIn optimization" | `/api/optimize-linkedin` — a **paste-your-profile → AI rewrite** feature. This is NOT the same as the new OAuth import. It stays in the free tier. |
| ATS-safe layouts | `_ATS_SAFE_LAYOUTS = {rClassic, rMinimal, rExecutive, rBanner}`; `_TABLE_LAYOUTS = {rSidebar, rTwoCol, rModern}` use tables (weaker ATS parse). |
| SEO pages | ~300 `*-resume.html` / `*-cover-letter.html` role + seniority pages, hubs, `/alternatives/*`, blog, `index.html`, `app.html`, `zh/`. Historically generated from a shared dataset (generators are in git history, not the tree). |

---

## 1. Recommended free/basic template set (needs your approval)

Design goals for the free set: **ATS-safe**, **universally professional** (not niche/decorative), and **visually distinct enough** that free users feel they have real choice, while the "wow" designs stay behind Pro.

### Resume — keep these 3 free (all ATS-safe base layouts)
| ID | Name | Layout | Why |
|---|---|---|---|
| `r1` | **Classic** | `rClassic` (serif, centered header) | Already free; the most universal, recruiter-safe format. Perfect ATS parse. |
| `r5` | **Executive** | `rExecutive` (sans-serif, left-bar accent) | Modern sans counterpart to Classic; ATS-safe; broad appeal for corporate roles. |
| `r17` | **Minimal** | `rMinimal` (clean serif, whitespace) | Distinct "clean" aesthetic; ATS-safe; covers the minimalist preference. |

### Cover letter — keep these 3 free
| ID | Name | Layout | Why |
|---|---|---|---|
| `c1` | **Formal** | `cFormal` (classic business letter) | Already free; the safest, most universal letter format. |
| `c5` | **Bold** | `cBold` (strong header, left-bar) | Sans-serif modern option; pairs with resume Executive. |
| `c17` | **Clean** | `cClean` (ultra-minimal) | Minimalist option; pairs with resume Minimal. |

This gives free users **3 genuinely different base designs** per type (serif-classic / sans-strong / minimal), each in one accent color, while all **color variants** (Forest, Ruby, Navy, …) and the higher-design layouts (Modern, Sidebar, TwoCol, Banner, Boxed, Split, Letter-Modern) become Pro.

**Alternative if you prefer the "color variants" framing** from your brief: we could instead keep e.g. `r1` Classic + `r2` Classic Forest + `r3` Classic Ruby (one layout, three colors) so the free set is deliberately more limited. I recommend **against** this — three real layouts is a stronger free offering that still leaves 53/45 templates as the Pro upsell. **Your call: approve the 3+3 above, or tell me which IDs to swap.**

---

## 2. Locking the rest behind Pro (technical approach)

**Single source of truth stays `OUT_TPLS` in `app.html`.** Implementation:

1. **Flip the flags.** Set `free:true` only on `r1, r5, r17, c1, c5, c17`; everything else `free:false`. (One-line edits per entry.)
2. **Client gating already works** off `tpl.free` in `renderTplPicker()` and the Samples-tab gallery — no logic change, just the data. Update the lock copy ("all 20 premium templates" → correct counts).
3. **Add server-side enforcement (new, important).** Today a free user can bypass the client and request a Pro template. I'll add a shared allow-list check:
   - Export the free-template ID sets to the server (small JSON module `remotion/`-style, or inline constant `FREE_TPL_IDS = { resume:[...], cover:[...] }` in `server.js`, kept in sync with `OUT_TPLS`).
   - In `/api/download-docx` and `/api/share` (and any template-bearing route), if the request is **not** from a subscriber and the chosen template ID is not in the free set, either (a) reject with 402, or (b) **downgrade to the watermarked free equivalent**. I recommend **(a) reject** for download-docx (clear signal) and rely on the watermark for the free templates.
   - `/api/download-docx` currently receives **no `email`** — I'll add `email` to the request body and run it through `isSubscriber()` (same pattern as every other route).
4. **Keep the two counts honest:** the library still *contains* 56+48. Marketing "100+ templates" stays true; what changes is "how many are free" (3+3) and "Pro unlocks the other 101."

**No change** to the "no fabricated metrics" prompt logic or DOCX-default export rules — this is purely gating + data.

---

## 3. Watermark approach

**Goal:** subtle brand mark at the **bottom** of free-tier resumes/cover letters, removed for Pro. Not a big overlay.

**Mark:** a single thin footer line, e.g. `Made with ResumeTailored AI · resumetailored.com`, small (8–9px), muted gray, centered. (The share page already has an equivalent footer, so this is consistent brand behavior.)

Applied in **all three export paths**, gated by `isSubscriber(email)`:

| Export | Where | How |
|---|---|---|
| **DOCX** | `buildTemplatedDocxBuffer()` (server.js ~1102) | Add `footers: { default: new Footer({ children: [ watermark Paragraph ] }) }` to each `sections[]` entry. Only include it when `!subscribed`. Requires importing `Footer` from `docx` and threading a `watermark` boolean into the builder. |
| **PDF** | `downloadPdf()` (app.html ~5149) | The print HTML is built client-side. Append a fixed-position footer `<div>` (or a `@page` bottom-margin running element) to the generated document, rendered only when `!isSubscriberFlag`. Use `position:fixed; bottom` with `print-color-adjust` so it lands at page bottom on every printed page. |
| **Share link `/r/:slug`** | `_shareResumeHtml()` (server.js ~1219) | Already shows a "Made with ResumeTailored AI" footer for everyone. For consistency we keep it; optionally strip it for Pro-published personal sites (see §5). |

**Removal for Pro:** the watermark is only injected when `!subscribed`. Because DOCX now needs to know subscription status, we pass `email` to `/api/download-docx` (see §2.3) and the PDF path already knows `isSubscriberFlag`.

**Tamper note:** the PDF watermark is client-side and technically removable by a determined user via devtools. That's acceptable (industry-standard for print-to-PDF); the DOCX and any server-rendered path are authoritative. I'll note this rather than over-engineer.

**Untouched:** DOCX-default export behavior and the no-fabricated-metrics rules stay exactly as-is.

---

## 4. LinkedIn OAuth import (free feature)

Use LinkedIn's **official OpenID Connect / OAuth 2.0** (no scraping). Realistic scope note up front: LinkedIn's public API (via "Sign In with LinkedIn using OpenID Connect") reliably returns **name, headline-ish profile basics, email, and picture** — it does **not** grant full work history / education / skills to standard apps anymore (that requires restricted partner programs). See Open Questions.

**Flow:**
1. Register a LinkedIn app; add env vars `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` (documented in `.env.example`). Feature is **optional** — if unset, the "Connect LinkedIn" button is hidden and nothing breaks (same pattern as Resend/ElevenLabs).
2. `GET /api/auth/linkedin` → redirect to LinkedIn authorize URL with `state` (CSRF token stored server-side/short-lived) and scopes (`openid profile email`, plus any partner scopes if we're approved).
3. `GET /api/auth/linkedin/callback` → verify `state`, exchange `code` for a token, fetch the `/v2/userinfo` (OIDC) profile, map fields → a `profileDraft` object.
4. Return the draft to `app.html`, which **pre-fills the resume builder** (name, headline→title, and whatever richer fields the granted scopes allow). User reviews/edits before tailoring — never auto-submitted.
5. Placement: an optional **"Connect LinkedIn to autofill"** button in onboarding / the builder's resume input area. Free, no gating.

**Data handling:** we only read profile fields to pre-fill the form; we do **not** persist LinkedIn tokens beyond the request unless we later want "reconnect." Document this in `privacy.html` (add a short clause).

**Fallback:** because full history/skills may not be available via API, the imported draft may be partial; the UI will say "We pulled what LinkedIn allows — fill in the rest." This keeps us honest and within LinkedIn's ToS. If you have LinkedIn partner API access, tell me and I'll widen the scopes.

---

## 5. Personal portfolio website (Pro-only)

Publish a resume as a live site at `name.resumetailored.com`. We already have 90% of the renderer: `_shareResumeHtml()`.

**Data model:** new SQLite table `personal_sites`:
`subdomain` (PK, lowercased, validated `^[a-z0-9-]{3,30}$`, blocklist of reserved names: `www, app, api, mail, admin, blog, static, cdn, r, preview, dashboard, …`), `email` (owner), `resume_text`, `layout`, colors, `photo`, `published` flag, `created_at`, `updated_at`.

**Publish flow (Pro-gated):**
- `POST /api/personal-site` — requires `isSubscriber(email)`; body includes the resume text + template + desired subdomain. Validates subdomain availability + format + blocklist, upserts the row. Returns `https://<sub>.resumetailored.com`.
- `DELETE /api/personal-site` / update to change subdomain or unpublish.
- Frontend: a **"🌐 Publish as Website"** button in `renderPreviewDownloadButtons()` (next to the video button), shown only for subscribers; free users see a Pro upsell.

**Subdomain routing:**
- **DNS:** add a wildcard `*.resumetailored.com` record pointing at the app (Railway supports wildcard custom domains; needs a wildcard TLS cert — Railway/again the platform handles Let's Encrypt, to confirm on the plan). This is an infra step you'll need to do in the registrar + Railway dashboard; I'll document it in `docs/RAILWAY_SETUP.md`.
- **App middleware:** early in `server.js` (before `express.static`), inspect `req.hostname`. If it's `<sub>.resumetailored.com` (and `<sub>` isn't a reserved/base host), look up `personal_sites` by subdomain and render the public site (reuse a `_personalSiteHtml()` built on `_shareResumeHtml()`), **indexable** (unlike `/r/:slug` which is `noindex`) with proper `<title>`/OG tags. 404 if not found/unpublished.
- Keep the apex + `www` behaving exactly as today (the middleware only diverts recognized personal-site subdomains).

**Why Pro:** each published site consumes our hosting/render per visit; gating matches the video generator's compute-cost rationale.

**Watermark on personal sites:** since these are a **paid** feature, they render watermark-free (Pro). I'll keep a small, tasteful "Made with ResumeTailored" footer as optional/removable — flagging for your preference.

**Reuse, not rewrite:** `_shareResumeHtml()` already renders every resume layout responsively and safely (all user values escaped). The personal-site renderer is a thin wrapper that swaps `noindex`→indexable, uses the subdomain URL for OG tags, and optionally drops the footer.

---

## 6. Content updates across the site

There are **two very different categories** of reference, and conflating them would cause needless churn:

**(A) Template-count mentions that are STILL TRUE** — "100+ templates", "56 resume + 48 cover letter templates", "104 templates". The library still contains these. **These mostly stay**, EXCEPT where they assert *free access* ("all 104 templates free", "2 free templates included", "Pro unlocks all 104").

**(B) Free-tier / feature-availability claims that are now WRONG and MUST change:**

| Old claim (verbatim, appears site-wide) | New claim |
|---|---|
| `1 free tailoring per day · No credit card required` | `Unlimited free resumes & cover letters · No credit card required` |
| `Pro ($19/mo) unlocks unlimited tailoring and all 100+ templates` | `Pro unlocks 100+ premium templates, the resume video, personal website & watermark-free exports` (unlimited tailoring is now free) |
| `2 free templates` / `Free members get 2 free templates` (app.html Samples tab ~1376, 1385, 1821) | `3 free resume + 3 free cover letter templates` |
| `all 20 premium templates per type` (template modal lock, app.html ~1498, 1909) | correct counts (53 resume / 45 cover Pro) |
| Free/Pro feature bullet lists (index.html pricing, app.html upsell ~2779) | Free = unlimited tailoring, LinkedIn optimize, ATS scanner, LinkedIn import, 3+3 templates, watermarked. Pro = everything free + 100+ templates, video, personal website, no watermark. |

**Pages affected (grouped):**
- `public/index.html` — homepage pricing/feature blocks + "100+ Templates" feature card.
- `public/app.html` — Samples tab header/subhead/free-note (~1375–1385, 1816–1821), template modal lock copy (~1498, 1909), upsell panel (~2779), LinkedIn optimizer "1 free per day" status (~2765), free-status wiring.
- `public/zh/index.html` + all bilingual strings (the role pages carry paired `['en','zh']` arrays — both languages need the same edit).
- `public/alternatives/*`, `*-alternative.html`, `enhancv-alternative.html`, etc. — comparison tables that cite our free tier vs competitors.
- `public/tailor-resume-to-job-description.html`, `ai-cover-letter-generator.html`, `ai-resume-tailor.html`, tools pages.
- **~300 `*-resume.html` / `*-cover-letter.html` role + seniority pages** — each contains the same `1 free tailoring per day` CTA line and `$19/mo` Pro line (shared boilerplate).
- `public/blog/*` — posts that describe the free tier / template counts (notably `best-resume-tools-international-job-seekers.html`; I'll grep every post for the phrases in category B).
- `public/cta-bar.js` — check its copy for free-tier claims.
- `cancel.html`, `success.html` — post-checkout copy.
- `CLAUDE.md`, `.env.example` — internal docs + new env vars.

**Execution approach for the ~300 pages:** because the category-B strings are **identical boilerplate**, I'll write a **one-off Node migration script** (`scripts/migrate-pricing-copy.js`) that does targeted, exact-string find-and-replace for the known phrases (both EN and ZH variants) across `public/**/*.html`, prints a per-file diff summary, and is safe to re-run (idempotent). I'll review its output, spot-check a sample of pages, then commit. Anything the script can't match cleanly gets flagged for manual edit rather than guessed. I will **not** hand-edit 300 files blindly.

**Pages I'll flag rather than auto-edit:** any page where the free-tier claim is woven into prose (blog paragraphs, comparison narratives) rather than the boilerplate CTA — those I'll list and edit deliberately.

---

## 7. Server-side gating changes summary (so nothing regresses)

- `/api/tailor`: **remove** the `resume`/`cover_letter` daily-limit checks and their `consumeFreeTier()` calls for free users → unlimited. (Leave rate-limiting/abuse protection intact; consider a global rate limiter to prevent abuse — see Open Questions.)
- `/api/ats-scan`, `/api/optimize-linkedin`: brief says free tier **keeps** these. Decide whether they become unlimited too or stay 1/day — **Open Question**.
- `/api/resume-video`: unchanged (Pro-only).
- `/api/download-docx`, `/api/share`: add `email` + subscriber check for template gating + watermark.
- New: `/api/auth/linkedin*`, `/api/personal-site*`, subdomain middleware.
- `usage_store` stays for whatever remains metered (video, and ATS/LinkedIn if we keep them daily).

---

## 8. Risks, tradeoffs, open questions

**Open questions (need your answers before/at implementation):**
1. **Price:** code says `$19/mo`; your brief says `$19.99`. Which is canonical? I'll standardize all copy to whichever you confirm. (Default: leave `$19` untouched unless you say otherwise.)
2. **Do ATS scanner + LinkedIn optimization become unlimited for free users, or stay 1/day?** Your brief lists them as "kept" but only explicitly makes *resumes/cover letters* unlimited. Recommendation: keep them metered (1/day) unless you want them unlimited.
3. **3+3 template picks** — approve my list (r1/r5/r17, c1/c5/c17) or swap IDs?
4. **LinkedIn scope reality:** standard LinkedIn OIDC won't return full work history/education/skills. OK to ship "autofill name/headline/photo + prompt user to complete," or do you have LinkedIn Partner API access for the richer fields?
5. **Wildcard DNS + TLS:** confirm the domain registrar + Railway plan support `*.resumetailored.com` with wildcard TLS. This is an infra prerequisite for personal websites; if not available, we fall back to path-based `resumetailored.com/site/name`.
6. **Personal-site footer:** watermark-free entirely, or keep a tasteful "Made with ResumeTailored" footer?

**Risks / tradeoffs:**
- **Abuse:** unlimited free tailoring raises Anthropic API cost exposure. Mitigation: add/keep IP rate limiting and possibly require a logged-in account for tailoring. Flagging as a business decision.
- **Client-only template gating today is a real hole** — the plan closes it server-side; must land with the free-flag flip or Pro templates leak.
- **Subdomain namespace collisions/abuse:** reserved-name blocklist + format validation + profanity check needed; someone could squat `apple.resumetailored.com`. Consider a claim-review or moderation step.
- **Content migration blast radius:** ~300 pages; the idempotent script + diff review mitigates, but a bad match pattern could corrupt pages — I'll dry-run and diff before writing.
- **Watermark on PDF is removable** (client-side print) — acceptable, documented.
- **Bilingual parity:** every EN string change needs its ZH pair or the `/zh/` pages drift.

---

## 9. Suggested build order (once approved)

1. Flip `OUT_TPLS` free flags (3+3) + server-side free-template allow-list + `email` on download-docx.
2. Watermark across DOCX / PDF / share.
3. Remove daily limits in `/api/tailor` (+ decide ATS/LinkedIn metering).
4. Content migration script + review + bilingual pass.
5. LinkedIn OAuth import.
6. Personal websites (table + API + subdomain middleware + DNS docs).
7. Final `CLAUDE.md` + `.env.example` updates; smoke test via the `site-check` skill.

**Awaiting your review — I will not start implementation until you confirm this plan and answer the open questions above.**
