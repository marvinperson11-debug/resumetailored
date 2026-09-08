# LinkedIn Optimizer — Phase 2 build

The LinkedIn Optimizer is now the full analyze → optimize tool from the spec: profile scoring with sub-scores, prioritized suggestions, keyword insights, Pro AI rewrites, and an Original ↔ Optimized side-by-side. `next build` is green.

> It replaces the thin Phase-2 optimizer (single `/api/linkedin-optimize` route). That old route is left in place (unused) to avoid touching unrelated code; the tool now uses the two new routes below.

## Pro gate (opens for all; paid actions gated)
- **Sidebar** — "LinkedIn Optimizer" keeps opening for everyone and now shows a **PRO** badge (no lock — analysis is free).
- **Free users** — can Analyze and see the **score + sub-scores + keyword insights + top 3 suggestions**. The "AI-optimized copy" buttons show a 🔒 and route to `/candidate?upgrade=pro`.
- **Pro users** — full suggestion list + AI-generated optimized headline (3 options), About, and rewritten experience bullets.
- **Server-side** — `/api/linkedin/analyze` caps suggestions to 3 for non-Pro (and flags `suggestionsTruncated`); `/api/linkedin/optimize` returns **402** for non-Pro.

## Left column
- **Tabs: Paste Profile / Paste URL.** Paste is the reliable path; URL is best-effort (see note). "…or auto-fill from a saved resume" pulls a My Resumes draft into the textarea.
- **Target role** (optional) — inferred from the profile if left blank.
- **Analyze my profile** — cycles progress steps ("Reading profile…" → "Analyzing keywords…" → "Scoring visibility…").
- **Score card** — 0-100 conic gauge (ATS-style) + four sub-score bars (Headline impact, About SEO, Experience depth, Keyword richness), each color-coded red <50 / yellow 50-75 / green 75+.
- **Suggestions** — numbered, priority-colored, each with issue + fix + a **Fix it** button (scrolls to the AI-copy card and, for Pro + a headline/about/experience section, kicks off that rewrite).
- **Keyword insights** — green pills = keywords you already have; red pills = high-value keywords missing.
- **AI-optimized copy (Pro)** — Optimize headline (3 options) / Optimize about / Rewrite experience. Each output has one-click **Copy** and **Apply to preview**.

## Right column — side-by-side
- **Original / Optimized** toggle. Original shows the pasted text; Optimized shows the applied AI pieces — headline highlighted in violet, rewritten About and Experience, and a skills row (present + missing keywords).
- **Copy all** copies the composed optimized profile as text.

## Routes
- **`POST /api/linkedin/analyze`** — `{ profileText, jobTitle? }` → `{ analysis: { score, jobTitle, breakdown{headline,about,experience,keywords}, suggestions[{issue,fix,priority,section}], presentKeywords[], missingKeywords[] }, pro, suggestionsTotal, suggestionsTruncated }`. Saves each analysis to `linkedin_analyses` (best-effort). All signed-in users; free gets top-3 suggestions.
- **`POST /api/linkedin/optimize`** — Pro-only. `{ profileText, section: "headline"|"about"|"experience", jobTitle? }` → `{ options: string[] }` (3 for headline, 1 for about/experience).
- **`POST /api/linkedin/scrape`** — best-effort LinkedIn URL → text (see note).

## Supabase
`supabase/migrations/0007_linkedin_analyses.sql` — exactly the spec's table (`id` identity PK, `user_id`, `profile_text`, `score`, `suggestions jsonb`, `created_at`, user/created index, RLS on). **Run it in the Supabase SQL editor** before relying on history/stats; the app still works without it (persistence is best-effort and silently no-ops).

## Files
**Added:** `lib/linkedin-ai.ts`, `lib/linkedin-store.ts`, `app/api/linkedin/{analyze,optimize,scrape}/route.ts`, `supabase/migrations/0007_linkedin_analyses.sql`.
**Changed:** `app/candidate/tools/linkedin-optimizer.tsx` (full rewrite), `components/candidate-sidebar.tsx` (PRO badge).

## Verify after deploy
Sign in → LinkedIn Optimizer → paste a profile (or auto-fill from a resume) → **Analyze** → see the gauge, sub-scores, keyword pills, suggestions. As **free**, the optimize buttons route to upgrade and only 3 suggestions show. As **Pro**, generate a headline/about/experience → Apply to preview → toggle Optimized → **Copy all**.

---

## One thing to note (my only real caveat)

**"Paste URL" is genuinely best-effort and will usually fail for real profiles.** LinkedIn login-walls profile pages to server-side fetches, so the scrape route almost always returns a "couldn't read much — paste instead" message. I scoped the fetch to **`linkedin.com` hosts only** (rather than the full job-board allowlist) specifically to avoid an SSRF surface — an authenticated endpoint that fetches arbitrary user-supplied URLs is a security risk, and LinkedIn is the only host this tool needs. If you'd rather I widen it to the whole job-import allowlist, or drop the URL tab entirely and keep Paste-only, say which — but paste (and the resume auto-fill) is the path that actually works, so the tab defaults to it and falls back to it on any failure.
