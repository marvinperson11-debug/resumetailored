# Response — Decisions Locked + Branch Base Confirmed

**Date:** 2026‑06‑26
**Re:** Your "Reply — Decisions + Go‑Ahead"
**This file lives on:** `claude/markdown-response-file-g3km0r`

Thanks for the clear decisions. This file records (a) the resolution of the one
open blocker — question 2, the branch base — with hard evidence, (b) all five
decisions locked in as binding constraints for the implementation, and (c) the
final plan I'll execute against.

---

## Question 2 — RESOLVED with evidence: PR #226 is **NOT merged**

I checked the live repo rather than assume:

- **PR #226** (`Website audit: remove exposed .bak files, fix sitemap…`) is
  **`state: open`, `draft: true`, `merged: false`**, base `main`, head
  `claude/website-audit-optimization-j07x4x` @ commit `6adcd2f`.
- **`origin/main`** sitemap contains **0** `resume-video` entries — so the
  `/tools/resume-video` fix and the `.bak` deletions are **not on `main`**.
- The branch `origin/claude/website-audit-optimization-j07x4x` exists.

**Per your decision #2 (the "NOT merged" branch of your instruction):**

> Base the new branch off the head of `claude/website-audit-optimization-j07x4x`
> so you don't redo or clobber that work. Do not base off plain `main`.

✅ **Confirmed plan:** create `claude/post-audit-fixes-and-output-qa` **off
`claude/website-audit-optimization-j07x4x` @ `6adcd2f`** (not off `main`).
First action after go: verify `/tools/resume-video` IS present in
`public/sitemap.xml` on that base before doing any Part 3/4 work, and confirm the
3 `.bak` files are already gone (so I don't re‑add or re‑delete them).

> ⚠️ One consequence to flag: because #226 is still an open draft, the eventual
> PR for `claude/post-audit-fixes-and-output-qa` will be **stacked on top of
> #226**. Its diff will look clean only if it targets `claude/website-audit-optimization-j07x4x`
> as its base, or if #226 merges first. I'll open it as a draft against `main`
> but call this out so the diff isn't confusing — tell me if you'd rather I set
> its base branch to the #226 branch explicitly.

---

## The 5 decisions — locked as binding constraints

| # | Decision | How I'll honor it |
|---|---|---|
| 1 | **Branch:** use `claude/post-audit-fixes-and-output-qa` | Create it off the #226 branch head; never push fixes to the markdown‑response branch. |
| 2 | **Base:** off #226 branch (it's unmerged) | Confirmed above. |
| 3 | **No "10,000+" metric** | Trust strip uses honest, defensible copy ("AI‑powered resume tailoring," "Powered by Anthropic Claude," real feature signals). **Zero fabricated numbers anywhere** (also governs items 11/12/13). If a real DB‑backed live count is wired later, we revisit. |
| 4 | **bcrypt + lazy migration — APPROVED** | Detect hash format on login: verify legacy `sha256('rta_salt_2026_'+pw)` hashes, transparently re‑hash to bcrypt on successful auth, **no forced reset**. Keep the legacy verify path. Treat as auth‑critical: test signup / login / reset thoroughly before committing. |
| 5 | **ATS study — option (b) or hold** | Build **only** from cited third‑party research + our own analysis, clearly labeled. **No fabricated pass‑rate stats, no presenting our numbers as a study.** If it can't be made credible with real citations, **skip it this PR** and note that in the PR. |

---

## Also doing (from my own findings, per your instruction)

- **Stale template count:** `server.js:2314` (and any other copy) says "20 resume
  templates" but the app ships **40** (`r1`–`r40`, `app.html:3180+`). I'll correct
  the count everywhere it appears across server + marketing/UI copy.
- **Sidebar color‑bleed in DOCX — treated as the headline Part 4 issue.** Plan:
  (a) document it in the bug table; (b) state plainly in the PR whether it's
  fixable in DOCX at all; (c) if not fixable, propose the best fallback — most
  likely a Word‑compatible approximation (e.g. a shaded full‑width header band or
  a tall shaded sidebar cell that grows with content) **and/or** a clear in‑app
  note that the Sidebar family is best exported as PDF. **No silently‑mismatched
  DOCX will ship.** (Code already flags this gap at `server.js:629–633`.)

---

## Part 4 scope — confirmed

**Accepted limitation:** the final printed **PDF** can't be pixel‑verified here
(`window.print()` of the HTML preview, `app.html:5076`); that visual check is
yours once the PR is up.

**What I will fully verify and fix in code:**
- DOCX output for **all 5 resume + 5 cover layout families** against realistic
  stress‑test data (long title, long company, multi‑line address, varied bullets,
  signature block).
- The **on‑screen HTML preview** for the same, driven via Playwright (Chromium is
  preinstalled).
- **Every divergence** between the HTML preview and the DOCX, catalogued.
- **Signature placement** (`server.js:1109+`), **date/recipient placement** &
  salutation/closing spacing (cover: `server.js:665+`, note it strips/regenerates
  "Dear …" at `:683–688`), **page‑break/orphan** behavior, and
  **accented/non‑Latin (EN/中文)** character handling everywhere reachable.
- **Template output vs. its selection card** (font/style/color/section order,
  cards at `app.html:3180+`/`3245+`).

**The PR description will include an explicit "Could NOT verify in sandbox"
section** listing exactly what you must manually check — at minimum: the PDF
print path, the browser file‑upload UX (multer 2.x frontend round‑trip,
`app.html:4407`), and any specific copy/number needing your sign‑off.

---

## Commit grouping (unchanged, as proposed)

1. `cookie banner` — slim bottom bar
2. `cta` — sitewide label standardization → "Tailor My Resume Free"
3. `cleanup` — delete 4 orphan concepts + remove dead `--gold` token
4. `security` — bcrypt + lazy migration; `/security-review` + `/code-review` notes
5. `multer` — 2.x upgrade + upload retest
6. `content` — role pages, listicle, comparison pages, ATS study (cited‑only or held); **every new page added to `sitemap.xml`**
7. `output-qa` — Part 4 renderer/card fixes + bug table

Then: open a **draft PR** with the full bug table and the manual‑check section.
**No live deploy.**

---

## Status / next action

The only blocker (branch base) is resolved. I'm ready to execute the above on
`claude/post-audit-fixes-and-output-qa` based off `claude/website-audit-optimization-j07x4x`.

Because my standing session constraint pins development to the
markdown‑response branch, I've put this confirmation here first. **Give me the
word and I'll create `claude/post-audit-fixes-and-output-qa` off the #226 head
and begin with commit group 1** — or, if this turn's "put your response in a
markdown file" was the deliverable you wanted, this file is it and I'll hold for
your explicit "go build it."
