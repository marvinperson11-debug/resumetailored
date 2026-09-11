# Decoder Key — build notes

The final Phase 2 candidate tool. It decodes a job posting — translating
corporate jargon to plain English, surfacing red flags, and revealing what an
employer actually wants — with a Pro tier for the deep analysis and side-by-side
comparison.

## ⚠️ One thing you need to run

Run the new migration in Supabase (SQL editor), same as the earlier tools:

```
supabase/migrations/0011_decoder_analyses.sql
```

It creates `decoder_analyses` (id, user_id, job_title, company, job_description,
depth, `analysis` jsonb, created_at) + a `(user_id, created_at)` index + RLS.
Until it's run, decoding still **works** (the AI runs and results render) — it
just won't persist history, and the free "1 decode/day" counter reads 0 (so free
users aren't hard-blocked by a missing table). Run it and both go live.

Nothing else to configure — it reuses the existing `ANTHROPIC_API_KEY` and the
Supabase env vars already set.

## What shipped

**Sidebar** — "Decoder" opens for **everyone** (not locked) but carries a **PRO
badge**, signalling it has paid features inside. Free users can open it and run a
basic decode; the paid surfaces gate in-tool.

**Two-column layout** (LEFT ~45% input + controls, RIGHT ~55% output cards):

- **LEFT** — Basic/Deep depth toggle (Deep shows a lock for free users and routes
  them to upgrade), a **Compare two** toggle (Pro), the shared **JdImport** URL
  importer, a **"…use a saved job from Job Finder"** dropdown (pulls your
  `job_saves`), the job-posting textarea (a second "Job B" textarea appears in
  compare mode), and — in Deep + Pro — an optional **resume picker** for a fit
  score. Decode button lives in the modal footer.
- **RIGHT** — result cards:
  - **Jargon translator** (always) — buzzword → what it really means, tagged
    info / warning / danger.
  - **Red flags** — free shows the **top 3**; Pro shows **all**. Each has a
    title, explanation, a 🚩×severity (1–3) meter, and a "how to ask about it in
    the interview" tip.
  - **Hidden requirements** (Pro) — 🔍 what they want but didn't say, with the
    phrase that implies it.
  - **Salary decoder** (Pro) — assessment + estimated range + comp breakdown +
    negotiation leverage.
  - **Culture signals** (Pro) — phrase → real meaning, a 0–100 culture score, and
    questions to verify it in the interview.
  - **The real ask** (Pro) — the AI's one-line "what they actually need", your
    **fit score** (when a resume is attached), and 3 things to emphasize.
  - **Compare mode** (Pro) — overall winner, category-by-category verdict,
    "best choice for" growth / pay / culture / learning, and combined red flags.

## Routes

- `POST /api/decoder/decode` — `{ jobDescription, depth: "basic"|"deep", resume? }`
  → `{ result: DecodeResult, pro, depth }`. Deep is Pro-only (**402
  `pro_required`**); free is capped at **1 decode/day** (**402 `daily_limit`**,
  counted from today's `decoder_analyses` rows). Basic returns jargon + exactly 3
  red flags; deep adds hidden requirements, salary, culture, the real ask, and
  (with a resume) a fit score. Every decode is saved best-effort.
- `POST /api/decoder/compare` — Pro-only (**402 `pro_required`**),
  `{ jobA, jobB, resume? }` → `{ result: CompareResult }`. Requires both postings
  ≥ 40 chars.

Model: `claude-sonnet-4-6`, JSON-only prompts with defensive normalizers
(`lib/decoder-ai.ts`) — a bad/short model reply fails cleanly rather than
rendering garbage.

## Files

| File | What |
|---|---|
| `lib/decoder-ai.ts` | Types, `buildDecodePrompt` / `buildComparePrompt`, `normalizeDecode` / `normalizeCompare`, `isDepth`. Pure, no DB/network. |
| `lib/decoder-store.ts` | `saveDecoderAnalysis`, `decodesToday` (free daily counter; returns 0 on any error so it never hard-blocks). |
| `app/api/decoder/decode/route.ts` | Decode route + Pro/daily gates. |
| `app/api/decoder/compare/route.ts` | Compare route (Pro-only). |
| `app/candidate/tools/decoder-key.tsx` | Full two-column UI (rewritten). |
| `app/candidate/components/tool-host.tsx` | Passes `isPro` to the tool. |
| `components/candidate-sidebar.tsx` | `Decoder` item now `pro: true` (badge, opens for all). |
| `supabase/migrations/0011_decoder_analyses.sql` | New table + index + RLS. |

## Decisions / notes

- **Free daily cap via row count, not a new usage table.** `decodesToday` counts
  today's `decoder_analyses` rows for the user rather than adding a separate
  counter table — one fewer migration, and it's naturally per-UTC-day. It
  **fails open** (returns 0 if Supabase is unreachable) so a config gap never
  locks a free user out entirely.
- **Saved-job dropdown reuses the Job Finder's `job_saves`** rather than a new
  store — consistent with how Job Finder + Career Hub already share tables.
- **Deep decode's resume picker reuses your saved resume drafts** (`/api/resumes`)
  so the fit score runs against a resume you already have.
- Build is green (`next build` — `✓ Compiled successfully`), no lint errors.

## Phase 2 status

Decoder Key was the **last Phase 2 candidate tool**. All six now ship: LinkedIn
Optimizer, Interview Coach, Job Finder, Career Hub, and Decoder Key (plus the
Phase-1 Resume / ATS / Cover tools).

_(Standing offer, not done unless you want it: a small cleanup PR to remove the
now-unused legacy single-file routes — `/api/linkedin-optimize`,
`/api/interview-coach`, `/api/career-hub`, `/api/decoder-key` — superseded by the
per-tool route folders.)_
