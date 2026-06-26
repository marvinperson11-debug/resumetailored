# Response — ResumeTailored: Post‑Audit Fixes + Output QA

**Date:** 2026‑06‑26
**Re:** "Fix Audit Findings + Full Output QA" (Parts 1–4, items 1–22)
**Branch this response lives on:** `claude/markdown-response-file-g3km0r`

This document is my response to the pasted prompt. You asked me to put my
response in a Markdown file, so this is an **engineering triage + plan**, not
the 22‑item code change itself. It is grounded in the actual code in this repo
(file/line references throughout) so you can see exactly what's true before any
work starts. Where the prompt's assumptions don't match what's in this checkout,
I call it out so we don't build on a false premise.

---

## TL;DR / read this first

Three things change how this should be run:

1. **Branch mismatch.** The prompt says *"Work on a new branch
   `claude/post-audit-fixes-and-output-qa`"* and references *"PR #226, branch
   `claude/website-audit-optimization-j07x4x`"*. Neither branch exists in this
   checkout — I'm on `claude/markdown-response-file-g3km0r`, cut from `main`,
   and my standing instructions pin me to that branch. I will **not** silently
   push to a different branch. Confirm which branch you want the actual fixes on.

2. **This checkout does not contain the audit PR's changes.** Item 14 says
   *"confirm the `/tools/resume-video` sitemap fix is still present."* It is
   **not** in `public/sitemap.xml` here (`grep` returns nothing). That fix lived
   in PR #226, which isn't merged into the `main` this branch came from. So
   either #226 hasn't merged, or this branch predates it. **Part 3/4 work must be
   based off the post‑#226 tree, or we'll redo/clobber existing work.**

3. **Part 4 (the "critical" output QA) cannot be fully verified in this
   sandbox.** Two hard blockers: (a) there is **no `ANTHROPIC_API_KEY`**, so I
   can't drive the real `/api/tailor` pipeline to produce genuine model output;
   (b) the **PDF export is the browser's own `window.print()`**
   (`public/app.html:5076`), not a server renderer — so "the PDF" only exists
   inside a real Chrome print job, which I can't pixel‑verify headlessly here.
   I *can* render the **DOCX** path (server‑side `docx`) and the **on‑screen
   HTML preview**, and I can drive the in‑browser preview with Playwright. What I
   cannot do is hand you a screenshot of the final printed PDF. That gap is
   flagged per‑item below and must stay on your manual‑check list.

Everything below is doable; I just want the above settled before writing code so
the PR lands on the right base and you know what "done" can and can't mean here.

---

## What I verified in the codebase (so the plan is grounded)

| Thing the prompt references | Status in this checkout | Evidence |
|---|---|---|
| Cookie banner is large/centered/floating | **Confirmed** — centered floating card, not a slim bar | `public/cookie-consent.js` (`#rta-consent{position:fixed;bottom:24px;left:50%;transform:translateX(-50%)…max-width:680px;padding:20px 24px}`) |
| 4 orphan `concept-*.html` files | **Confirmed, and they have zero inbound references** | `public/concept-1-aurora-depth.html`, `concept-2-editorial-noir.html`, `concept-2b-editorial-refined.html`, `concept-3-liquid-chrome.html`; `grep -rln "concept-"` across HTML/XML/TXT → no hits |
| `--gold` token duplicates `--indigo` | **Confirmed** — `--gold: #6366F1` (identical to indigo) | `public/style.css:23` |
| Static‑salt SHA‑256 | **Confirmed, and it's for user passwords only** | `server.js:163` `crypto.createHash('sha256').update('rta_salt_2026_' + pw)`; used at signup `:255`, login `:365`, reset `:573` |
| `multer` 1.x | **Confirmed** — `"multer": "^1.4.5-lts.1"`; one upload path | `package.json`; config `server.js:581`, `upload.single('file')` at `/api/extract-text` `server.js:598` |
| `/tools/resume-video` in sitemap | **MISSING here** (see TL;DR #2) | `grep resume-video public/sitemap.xml` → no match |
| Resume/cover‑letter templates | **40 resume + 20 cover templates** across 5 layout families each | `public/app.html:3180–3223` (`r1`–`r40`), `:3245–3284` (`c1`–`c20`) |
| Marketing copy says "20 resume + 20 cover" | **Copy is stale** — code has 40 resume templates | `server.js:2314` says "20 resume templates"; app defines `r1`–`r40` |
| PDF export mechanism | **Browser `window.print()`**, not a server renderer | `public/app.html:5076` |
| DOCX export mechanism | **Server‑side `docx` package**, template‑aware engine | `server.js:15`, engine from `:624`, signature logic `:1109–1130` |

That last block matters for Part 4: **PDF and DOCX are produced by two entirely
different engines** (Chrome print of the HTML preview vs. a hand‑built `docx`
document). "Cross‑format consistency" (item 20) is therefore a *real* risk area,
and the code already documents one known gap: full‑height sidebar color bleed
can't be reproduced in Word (`server.js:629–633`).

---

## Part 1 — Quick marketing fixes

| # | Item | Assessment & plan | Confidence |
|---|---|---|---|
| 1 | Slim cookie bar | Rewrite `public/cookie-consent.js`: swap the centered `max-width:680px` card for a full‑width fixed bottom bar (~52px), keep the existing `rta_cookie_consent` localStorage key + Consent Mode v2 wiring (don't regress GDPR behavior). Verify it doesn't overlap the homepage before/after demo. | High |
| 2 | One CTA label sitewide | Inventory every primary CTA (nav/hero/footer/blog/SEO pages) and standardize on **"Tailor My Resume Free."** This spans `index.html`, `how-it-works.html`, all `*-alternative.html`, `alternatives/*`, `tools/*`, `blog/*`. Needs a careful grep‑and‑replace with manual review per file (some buttons deep‑link to `/app`, some to `#demo`). | High |
| 3 | Delete 4 orphan concepts | Safe to remove — no references found. Delete the 4 files; they're not in `sitemap.xml` or `robots.txt`, so no further cleanup needed. | High |
| 4 | Trust strip under hero CTA | Add a lightweight inline strip (text + inline SVG stars, no new image assets) between CTA and demo. **Caveat:** "10,000+ resumes tailored" must be a real/defensible number — flag for your sign‑off before publishing a specific figure (see "Truth in claims" below). | High (impl) / needs your input (the number) |
| 5 | Tighten hero whitespace | CSS spacing trims on `how-it-works.html` and the alternative pages. Low‑risk, per‑page visual check. | Med (needs visual confirm) |
| 6 | "See how it works" ghost button | Add secondary button next to hero CTA in `index.html`, linking to the how‑it‑works section/page. | High |

---

## Part 2 — Security & code health

| # | Item | Assessment & plan | Confidence |
|---|---|---|---|
| 7 | Upgrade multer 1.x → 2.x | Only one upload path (`upload.single('file')` → `/api/extract-text`, `server.js:598`) and it uses `memoryStorage` + `fileFilter` + 10 MB limit. multer 2.x's breaking changes are mostly around error handling and the removal of some deprecated behaviors; this config is simple enough that the upgrade is low‑risk. Plan: bump dep, re‑test the resume‑upload path (txt/pdf/doc/docx) end‑to‑end. **Sandbox caveat:** I can unit‑exercise the route with sample files, but the *frontend* upload UX (`handleResumeUpload`, `app.html:4407`) needs a real browser check. | High (server) / Med (UX) |
| 8 | Static‑salt SHA‑256 | **What it's used for (you asked to be told first): user‑account passwords only** — `hashPw()` at `server.js:163`, called on signup (`:255`), login (`:365`), and password reset (`:573`). It is **not** used for Stripe, sessions (those are UUIDs), or reset tokens. So this *is* credential hashing, and the current scheme is weak: a single global salt (`rta_salt_2026_`) + unsalted‑per‑user SHA‑256 = fast, rainbow‑table‑able, no per‑record salt. **Recommendation:** migrate to `bcrypt` (or `argon2`). Migration plan: add a `password_algo` column (or detect hash format), verify old SHA‑256 hashes on login and transparently re‑hash to bcrypt on successful auth ("lazy migration") — no forced reset, no data loss. I'll write this up in the PR, but given it touches auth I'd want your explicit go‑ahead before changing the hashing in place. | High (diagnosis) / needs sign‑off (change) |
| 9 | `--gold` token | It's dead — identical to `--indigo` (`#6366F1`) and I'll confirm zero meaningful visual uses before acting. Recommend **removing** the token unless you want a real gold accent (then I'd set e.g. `#D4AF37` and apply intentionally). Default plan: remove. | High |

I can also run the `/security-review` and `/code-review` skills against `server.js`
as the prompt asks (item 8) and fold their findings into the PR.

---

## Part 3 — Growth/content (lower priority)

All doable, all mechanical once Parts 1–2 land. Key constraints:

- **Item 10 (10–15 role landing pages):** follow the existing SEO page template
  (e.g. `tailor-resume-to-job-description.html`). **Every new page must be added
  to `sitemap.xml`** (item 14) — I'll treat sitemap inclusion as part of "done"
  for each page, not an afterthought.
- **Item 11 (best‑AI‑resume‑builders‑2026 listicle):** must use the
  blog dual‑file convention from `CLAUDE.md` (`.html` served + `.md` source +
  a card in `public/blog/index.html`).
- **Item 12 (ATS pass‑rate study):** ⚠️ **This is the riskiest item.** A
  "study" page is a backlink magnet *only if credible*. We do **not** have real
  ATS pass‑rate data. I will **not** fabricate statistics. Options: (a) clearly
  labeled methodology with a small, honestly‑described sample; (b) an aggregation
  of cited third‑party research with our analysis; (c) hold this item until you
  can supply real data. **Needs your decision before I build it.**
- **Item 13 (`enhancv-alternative`, `zety-alternative`, "Claude vs ChatGPT for
  resumes"):** straightforward comparison pages on the existing template; same
  sitemap rule.
- **Truth in claims (applies to 4, 11, 12, 13):** the prompt itself says "don't
  fabricate claims." I'll keep every comparative/statistical claim either
  sourced or removed, and surface any number that needs your verification.

---

## Part 4 — Resume & Cover Letter Output QA (the critical part)

This is where the honest scoping matters most. Here's the architecture and what
each export path allows in this sandbox:

- **On‑screen preview:** HTML/CSS rendered in `app.html` from the tailor output.
  → I can drive this with Playwright (Chromium is preinstalled) and screenshot it.
- **DOCX:** server‑side, hand‑built with the `docx` package (`server.js:624+`).
  → I can generate real `.docx` files from sample text and inspect them.
- **PDF:** the browser's `window.print()` of the preview (`app.html:5076`).
  → **Not headlessly verifiable as a true PDF here**; depends on the user's
  Chrome print engine. This is the main item I can't fully close in‑sandbox.

40 resume templates (5 layouts × 8 colors) + 20 cover templates (5 × 4). Color
variants share a layout engine, so QA effort is really **~5 resume layouts + ~5
cover layouts × edge cases**, which is tractable.

| # | Item | What I can do here | What needs your manual check |
|---|---|---|---|
| 15 | Realistic sample per template | Build one rich fixture (long title, long company, multi‑line address, varied bullets, signature block) and run it through the **DOCX engine** + **HTML preview** for each of the 5 layout families. | Final **PDF print** appearance |
| 16 | Signature placement | Audit the DOCX signature logic (`server.js:1109–1130`) — it already uses `keepNext`/`keepLines` to avoid orphaning and dropped the old 2‑inch forced gap. I'll stress it with a long signature/name. | Signature in printed PDF |
| 17 | Output matches the selection card | Compare each template's rendered output to its card's declared `serif`/`style`/color (`app.html:3180+`). Mismatches → fix renderer or card. | Pixel‑level PDF match |
| 18 | Edge cases | Long name/title overflow, long bullets, few‑section vs many‑section, **special/accented/non‑Latin chars** (product is bilingual EN/中文 — high priority), single‑ vs multi‑page. I can exercise these against DOCX + HTML preview. | Multi‑page **PDF** page‑break behavior |
| 19 | Cover‑letter specifics | Verify date format/placement, recipient block, salutation/closing spacing in `_dxParseCover` (`server.js:665+`) and the cover layouts; note it intentionally strips the model's salutation/closing and renders its own (`server.js:683–688`) — I'll confirm that doesn't double‑up or drop the recipient. | Printed PDF |
| 20 | Cross‑format consistency | **Highest‑value finding area.** PDF (Chrome print of HTML) vs DOCX (hand‑built Word) are separate engines; the code already flags one known gap (full‑height sidebar color bleed can't render in Word — `server.js:629–633`). I'll catalog every divergence I can detect between the HTML preview and the DOCX. | Confirming the PDF half of each comparison |
| 21 | Document every bug | I'll produce a bug table (template/layout, what's wrong, severity, repro) and fix what's fixable in code. | — |
| 22 | Re‑generate & confirm no regressions | Re‑run DOCX + preview after fixes. | Final PDF re‑confirm |

**Known/likely issues to investigate first (from reading the code, not yet
confirmed as bugs):**

1. **Sidebar color bleed** is explicitly un‑reproducible in DOCX
   (`server.js:629–633`) → the Sidebar family's `.docx` will *not* match its
   card/PDF. This is a real, already‑documented PDF↔DOCX divergence (item 20/17).
2. **Marketing copy vs reality:** `server.js:2314` advertises "20 resume
   templates" but the app ships 40. Not a render bug, but a user‑facing
   inconsistency worth fixing in the same pass.
3. **Cover‑letter salutation handling** strips and regenerates "Dear …"
   (`server.js:683–688`) — needs verification that the regenerated recipient
   block uses the real company/role and spacing is correct (item 19).

---

## Deliverable plan (commit grouping, per your spec)

When you green‑light the actual implementation (on the agreed branch), I'll group
commits exactly as you asked:

1. `cookie banner` — slim bottom bar
2. `cta` — sitewide label standardization
3. `cleanup` — delete orphan concepts + remove `--gold`
4. `security` — bcrypt migration for passwords (lazy re‑hash) + security/code review notes
5. `multer` — 2.x upgrade + upload retest
6. `content` — role pages, listicle, comparison pages, ATS study (per your call on #12), each added to `sitemap.xml`
7. `output-qa` — Part 4 renderer/card fixes

…then open a **draft PR** with a summary listing every bug found, every fix, and
an explicit "could not verify in sandbox" section (the PDF print path, the
browser upload UX, and any specific stat needing your sign‑off).

---

## Decisions I need from you before writing code

1. **Which branch** should the real fixes go on? (Prompt says
   `claude/post-audit-fixes-and-output-qa`; I'm pinned to
   `claude/markdown-response-file-g3km0r`.)
2. **Is PR #226 merged?** If not, I should base Part 3/4 on that tree so I don't
   redo the `/tools/resume-video` sitemap fix and other audit work.
3. **The "10,000+ resumes tailored" trust number** (item 4) — real figure, or
   should I use softer, defensible copy?
4. **Password hashing change** (item 8) — confirm you want bcrypt + lazy
   migration before I touch auth.
5. **ATS study data** (item 12) — real data, cite third‑party research, or hold?

Once those are settled I can start implementing immediately.
