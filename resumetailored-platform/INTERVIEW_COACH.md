# Interview Coach — Phase 2 build

The Interview Coach is now the full spec'd tool: setup → role-specific questions → per-answer STAR feedback → readiness tracker → coaching tips → a Pro mock-interview flow with a saved final report. It replaces the thin Phase-2 version. `next build` is green.

> The old `/api/interview-coach` route is left in place (unused) to avoid touching unrelated code; the tool now uses the three new routes below.

## Pro gate (opens for all; paid features gated)
- **Sidebar** — "Interview Coach" keeps opening for everyone and now shows a **PRO** badge (no lock).
- **Free** — generates the full set but sees the **first 5 questions**; the rest are a blurred "Upgrade to see all 15" card. **Basic feedback** (score + 1 strength + 1 improvement, no model answer / STAR). The mock-interview button routes to upgrade.
- **Pro** — all 15 questions, **detailed feedback** (multiple strengths/improvements + model answer + STAR check), and the **full mock interview**.
- **Server** — `/questions` returns only 5 to free (+ true `total`, `lockedCount`); `/feedback` trims to the free shape server-side for non-Pro; `/mock` returns **402** for non-Pro.

## Left column — setup + questions + answers
- **Setup card:** JD textarea + **URL import** (shared `JdImport`, same allowlist as the resume builder), resume textarea + **My Resumes** picker, **Interview type** (Behavioral / Technical / Situational / Culture fit / Salary negotiation), **Difficulty** (Entry / Mid / Senior / Executive).
- **Question list:** numbered cards with a category tag and **1–3 difficulty dots**; **Answer** expands a textarea with a **char counter** and **Record** (browser speech-to-text, shown only when supported). "Get feedback" (Pro) / "Basic feedback" (free) per card. Answered cards show their score.
- **Blur gate:** free users get a blurred locked card — "Upgrade to see all {total} questions" → upgrade flow.

## Right column — feedback + coaching + progress + mock
- **Progress tracker:** conic **readiness ring** + "Readiness score /100" (from answer scores × coverage) + "N of M answered".
- **Feedback panel:** color-coded answer score, **STAR check** chips (Situation / Task / Action / Result) for behavioral & situational, Strengths, Improvements, and a **Model answer** (Pro; free sees an upgrade note).
- **Coaching tips:** "Common mistakes for this role" + "Top things to mention" (both AI-generated from the JD alongside the questions, so no extra round-trip) + a collapsible **body-language reminder**.
- **Full mock interview (Pro):** "Start full mock interview" opens a focused flow — the AI asks one question at a time (up to 6), you answer (type or record), and at the end you get a **final report** (overall score, strongest answer, weakest answer, 3 things to practice), **saved to Supabase**.

## Routes / data
- `POST /api/interview/questions` → `{ questions[], coaching, pro, total, lockedCount }` (all signed-in; free capped to 5).
- `POST /api/interview/feedback` → `{ feedback: { score, strengths[], improvements[], modelAnswer, starCheck } }` (detailed for Pro; trimmed for free).
- `POST /api/interview/mock` (Pro) → `{ nextQuestion, isFinal, report? }`; saves the session on the final turn.
- `supabase/migrations/0008_interview_sessions.sql` — the spec table. **Run it in the Supabase SQL editor** for mock history/stats; the tool works without it (persistence is best-effort).

## Files
**Added:** `lib/interview-ai.ts`, `lib/interview-store.ts`, `app/api/interview/{questions,feedback,mock}/route.ts`, `supabase/migrations/0008_interview_sessions.sql`.
**Changed:** `app/candidate/tools/interview-coach.tsx` (full rewrite), `components/candidate-sidebar.tsx` (PRO badge).

## Verify after deploy
Sign in → Interview Coach → paste a JD (or import URL) + optionally a resume → pick type + difficulty → **Generate questions** → see coaching tips + questions. **Free:** 5 visible, rest blurred; Basic feedback; mock → upgrade. **Pro:** all 15; expand a question → answer (or **Record**) → **Get feedback** (STAR chips + model answer) → readiness ring climbs → **Start full mock interview** → answer through it → **final report**.

---

## One caveat (and a note)

- **Speech-to-text is best-effort.** It uses the browser Web Speech API (`webkitSpeechRecognition`), which is Chrome/Edge/Safari-ish and requires mic permission; the **Record** button only appears when the browser supports it, and typing always works. It streams to whichever answer box is open.
- **Mock length is capped at 6 questions** (server constant `MAX_MOCK_Q`) to keep credit spend and latency sane — the spec said "5–10". Easy to bump if you want longer mocks; say the word.
