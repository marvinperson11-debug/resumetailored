# Career Hub Expansion — Technical Plan

> **Status:** Proposal for review. Nothing in this document has been built. It is
> a blueprint for turning the existing Career Hub (forum + salary guides +
> quarterly check-ins) into a **profession-first, one-stop career platform**
> where a single saved profession drives every tool: Skills Lab, Interview Prep,
> Job Finder, Skills Gap Analyzer, and a unified Dashboard.

---

## 0. Grounding: what exists today

This plan is written to fit the current architecture, not to fight it.

| Concern | How it already works | Implication for this plan |
|---|---|---|
| Backend | One file, `server.js` (~6,000 lines): Express, all routes, Stripe, auth, file parsing, DOCX. | New routes/helpers land in `server.js`. No microservices. |
| DB | `better-sqlite3` at `${DATA_DIR}/resumetailor.db`, prepared statements, `CREATE TABLE IF NOT EXISTS` at boot, `_ensureColumn()` for migrations. | New tables + columns follow the same pattern. |
| LLM | **Anthropic SDK only** — `anthropic.messages.create({ model: 'claude-sonnet-4-6', ... })`. No OpenAI in the tree. | **Recommend staying Anthropic-only** (see §7.1). Add `claude-haiku-4-5` for cheap/cacheable calls. |
| Auth | UUID session tokens in `localStorage` (`rt_token`), validated by `getSessionEmail(req)` → email or null. | Every new route authenticates the same way. |
| Pro gating | `isSubscriber(email)` (owner + `COMP_EMAILS` + `subscribers` table). | Reuse verbatim; return `402 pro_only` like `/api/resume-video`. |
| Free metering | `usage_store` keyed `${userKey}_${date}_${type}`; helpers `getTodayKey`, `hasFreeTierLeft`, `consumeFreeTier`. | Extends cleanly to per-day quiz/gap limits. |
| Rate limiting | `express-rate-limit`; e.g. `tailorLimiter` = 20/min. | Add per-feature limiters (`skillsLabLimiter`, `jobSearchLimiter`, …). |
| Frontend | `public/app.html` — one SPA, tabs via `showTab(name)`, sidebar `<button ... onclick="showTab('...')">`. No framework, no router, no build step. | New tools are new tabs + `showTab` cases. Career Hub becomes a sub-nav group. |
| Existing hub | `check_ins` table already has `current_role`, `target_role`, `goals`. Tabs: `forum`, `salary`, `checkin`. | **The profession selector extends `check_ins`, it doesn't invent a profile from scratch.** |
| Email | `notifyOwner()` / `sendEmail()` via Resend (optional). | Reused for badge/limit notifications if wanted. |

**Design principle:** the user picks a profession **once**; it is stored on their
profile and injected into every prompt and every filter. No tool asks "what do
you do?" twice.

---

## 1. Profession Selector System

### 1.1 The profession database

A **static, versioned JSON file** shipped with the app (no DB table, no admin UI
needed for v1). It is a curated taxonomy — categories → professions → optional
seniority hints and keyword seeds.

`public/data/professions.json` (served statically, also `require()`-able server-side):

```jsonc
{
  "version": "2026-08-01",
  "categories": [
    {
      "id": "healthcare",
      "label": "Healthcare",
      "icon": "🩺",
      "professions": [
        { "id": "registered-nurse",  "label": "Registered Nurse",       "aliases": ["RN"],  "seniority": true },
        { "id": "nurse-practitioner","label": "Nurse Practitioner",      "aliases": ["NP"],  "seniority": true },
        { "id": "physical-therapist","label": "Physical Therapist",      "aliases": ["PT"],  "seniority": true },
        { "id": "medical-assistant", "label": "Medical Assistant",       "aliases": ["MA"],  "seniority": false }
      ]
    },
    { "id": "trades",     "label": "Skilled Trades",        "icon": "🔧", "professions": [ /* electrician, plumber, HVAC, welder, carpenter, ... */ ] },
    { "id": "tech",       "label": "Technology",            "icon": "💻", "professions": [ /* software-engineer, data-analyst, devops, ... */ ] },
    { "id": "legal",      "label": "Legal",                 "icon": "⚖️", "professions": [ /* paralegal, attorney, compliance, ... */ ] },
    { "id": "business",   "label": "Business & Management",  "icon": "📊", "professions": [ /* project-manager, product-manager, ... */ ] },
    { "id": "finance",    "label": "Finance & Sales",        "icon": "💰", "professions": [ /* accountant, financial-analyst, sales-rep, ... */ ] },
    { "id": "education",  "label": "Education",              "icon": "🎓", "professions": [ /* teacher, professor, instructional-designer, ... */ ] },
    { "id": "creative",   "label": "Creative & Media",       "icon": "🎨", "professions": [ /* graphic-designer, copywriter, videographer, ... */ ] },
    { "id": "science",    "label": "Science & Research",     "icon": "🔬", "professions": [ /* lab-technician, research-scientist, ... */ ] },
    { "id": "hospitality","label": "Hospitality & Service",  "icon": "🍽️", "professions": [ /* chef, hotel-manager, server, ... */ ] }
  ]
}
```

**Why static JSON, not a DB table:** the taxonomy is small (~10 categories,
~200 professions), read-only, and identical for all users. Shipping it as a file
means zero migration risk, it's diffable in git, and both the client picker and
the server prompt-builder read the *same* source of truth. The role pages we
already generate (`*-resume.html`, 70 roles in 7 categories — see `CLAUDE.md`)
give us a ready-made seed list; **reuse those role slugs** so a profession like
`software-engineer` links straight to its existing SEO page.

> Note: many `profession.id` values will intentionally match existing role-page
> slugs (`software-engineer`, `registered-nurse`, …). That lets the Dashboard
> deep-link to `/software-engineer-resume` and the cross-sell sidebar to reuse
> existing content for free.

### 1.2 Storage in the user profile

Extend the **existing `check_ins` table** rather than creating a new profile
table — it is already the per-user career-state row, keyed by `email`.

```js
// server.js, alongside the other _ensureColumn() calls
_ensureColumn('check_ins', 'profession_id',  "profession_id TEXT DEFAULT ''");   // e.g. "registered-nurse"
_ensureColumn('check_ins', 'profession_cat', "profession_cat TEXT DEFAULT ''");  // e.g. "healthcare"
_ensureColumn('check_ins', 'seniority',      "seniority TEXT DEFAULT ''");       // '', 'entry-level', 'mid', 'senior', 'lead'
_ensureColumn('check_ins', 'profession_set_at', 'profession_set_at INTEGER');
```

New endpoints:

```
GET  /api/profession        → { professionId, category, seniority, label } | {} if unset
POST /api/profession        → body { professionId, seniority? }  (auth required)
                              validates professionId against professions.json,
                              upserts into check_ins, returns the normalized profile.
```

The `POST` must **validate against the JSON** (reject unknown ids) so downstream
prompt-builders can trust the value. A row in `check_ins` is created on first
save if the user has never checked in.

### 1.3 How it feeds every other tool

A single server helper is the contract:

```js
// Returns { id, label, category, categoryLabel, seniority, keywords[] } or null
function getUserProfession(email) {
  const row = db.prepare('SELECT profession_id, profession_cat, seniority FROM check_ins WHERE email = ?').get(email);
  if (!row || !row.profession_id) return null;
  return resolveProfession(row.profession_id, row.seniority); // reads professions.json
}
```

Every new tool calls `getUserProfession(email)` first:

```
                          ┌─────────────────────────┐
                          │  check_ins.profession_id │  (single source of truth)
                          └───────────┬─────────────┘
                                      │ getUserProfession(email)
      ┌───────────────┬───────────────┼───────────────┬────────────────┐
      ▼               ▼               ▼               ▼                ▼
 Skills Lab     Interview Prep    Job Finder     Gap Analyzer      Dashboard
 (quiz prompt   (question prompt  (auto-filter   (job-req prompt   (status +
  seed)          seed)            query + loc)    context)          next steps)
```

**Client UX:** a searchable modal (`professionPicker`) — a text input that
filters the flat list of `{category → professions}`, grouped headers, keyboard
navigable. On mobile it's a bottom sheet. First-run: if a signed-in user opens
any Career Hub tool with no profession set, we present the picker before the
tool (a soft gate, dismissible once but re-prompted). The picker is also
reachable from the Dashboard header ("Target role: Registered Nurse ✎").

---

## 2. Role-Specific Skills Lab (Dynamic Quiz Engine)

### 2.1 Architecture

Generate a profession-specific assessment **on demand** with Claude, then
**cache aggressively** so the same profession+seniority+topic doesn't re-bill.

```
User clicks "Take the [Registered Nurse] Skills Test"
        │
        ▼
POST /api/skills-lab/quiz  { topic? }        (auth required)
        │
        ├── getUserProfession(email)  → { id, label, seniority }
        │
        ├── cacheKey = sha256(professionId + seniority + topic + PROMPT_VERSION)
        │
        ├── quiz_cache HIT?  ──► return cached JSON  (0 tokens, instant)
        │        │ MISS
        │        ▼
        ├── anthropic.messages.create(model: claude-haiku-4-5, JSON quiz prompt)
        │        │
        │        ├── parse + validate JSON (retry once on parse failure)
        │        └── INSERT into quiz_cache (persist for reuse)
        │
        └── return { quizId, questions[] }  (WITHOUT correct answers — see 2.3)
```

**Model choice:** `claude-haiku-4-5` for quiz generation. Multiple-choice
question generation is well within Haiku's ability and it is ~10–15× cheaper
than Sonnet. Sonnet is reserved for the Gap Analyzer (§5) where reasoning
quality matters more.

### 2.2 Prompt structure, caching, JSON format

**Caching strategy (three layers):**

1. **Persistent content cache (`quiz_cache` table).** The killer optimization.
   A quiz for `registered-nurse / senior / fundamentals` is generated **once for
   the entire user base** and served from SQLite forever after (invalidated only
   when `PROMPT_VERSION` bumps). With ~200 professions × ~3 seniority × ~4 topics
   ≈ 2,400 possible quizzes, the whole catalog costs a few dollars to generate
   lazily and then bills nothing.
2. **Anthropic prompt caching** (`cache_control` on the static system prompt) for
   the cold-generation path, so the large instruction block isn't re-charged.
3. **Pre-generation (optional, Phase 4):** a script warms `quiz_cache` for the
   top 20 professions overnight so the first user never waits.

```
quiz_cache
  cache_key      TEXT PRIMARY KEY   -- sha256(profId|seniority|topic|PROMPT_VERSION)
  profession_id  TEXT NOT NULL
  seniority      TEXT
  topic          TEXT
  payload        TEXT NOT NULL      -- full JSON incl. correct answers + explanations
  created_at     INTEGER NOT NULL
```

**Sample prompt (system + user):**

```
SYSTEM (cache_control: ephemeral):
You are an expert assessment writer for professional skills tests. You write
fair, unambiguous multiple-choice questions that test real on-the-job competence,
not trivia. Output ONLY valid JSON matching the schema. No markdown, no preamble.

USER:
Write a 10-question multiple-choice skills assessment for this role:
  Profession: Registered Nurse
  Seniority:  Senior
  Topic:      Patient Safety & Medication Administration

Rules:
- 10 questions, each with exactly 4 options.
- Exactly one correct option per question.
- Mix difficulty: 3 easy, 5 medium, 2 hard.
- Each question includes a one-sentence explanation of why the answer is correct.
- No question may reference a specific hospital, brand, or country's regulations
  unless universally standard.
Return JSON:
{
  "title": "Registered Nurse — Patient Safety (Senior)",
  "questions": [
    {
      "id": 1,
      "difficulty": "easy|medium|hard",
      "prompt": "…",
      "options": ["A…","B…","C…","D…"],
      "answerIndex": 0,
      "explanation": "…"
    }
    // …10 total
  ]
}
```

**Validation:** parse JSON; assert exactly N questions, 4 options each,
`answerIndex ∈ 0..3`, non-empty explanation. On failure, retry once with a
"your previous output was invalid JSON, return only the JSON" nudge; on second
failure return `503 quiz_unavailable` (never show a broken quiz).

### 2.3 Delivery UI, scoring, retakes, progress

- **Server never ships answers to the client up front.** `GET`/`POST
  /api/skills-lab/quiz` returns questions with `answerIndex`/`explanation`
  stripped. The user submits answers to `POST /api/skills-lab/submit
  { quizId, answers[] }`; the server scores against the cached payload and
  returns `{ score, correct[], explanations[] }`. This prevents "view source"
  cheating and keeps the badge meaningful.
- **Scoring:** percentage correct; band into Bronze (≥60) / Silver (≥80) /
  Gold (≥95). Store the best attempt.
- **Retakes:** allowed. Because questions are cached and identical, add light
  **question shuffling** (server shuffles option order per attempt using a seed)
  so a retake isn't pure memorization. Free tier gets limited retakes (§9).
- **Progress tracking (`skill_attempts` table):**

```
skill_attempts
  id            INTEGER PK AUTOINCREMENT
  email         TEXT NOT NULL
  profession_id TEXT NOT NULL
  topic         TEXT
  score         INTEGER      -- 0..100
  band          TEXT         -- bronze|silver|gold
  taken_at      INTEGER NOT NULL
  INDEX (email, profession_id)
```

The Dashboard reads best-per-topic from this table.

### 2.4 Shareable badge system

- On a passing score, mint a badge row:

```
badges
  slug          TEXT PRIMARY KEY   -- short random, used in the public URL
  email         TEXT NOT NULL
  profession_id TEXT NOT NULL
  topic         TEXT
  band          TEXT               -- bronze|silver|gold
  score         INTEGER
  created_at    INTEGER NOT NULL
```

- **Public badge page** `GET /badge/:slug` — a lightweight, noindex-optional,
  OG-tagged page ("Jane D. — Gold, Registered Nurse Patient Safety, 96%") with a
  ResumeTailored footer and a CTA. Renders via the same server-side HTML pattern
  as `/r/:slug` share links (reuse the `_shareResumeHtml` approach — a small
  dedicated renderer, not the resume one).
- **Share affordances:** "Copy link", "Share on LinkedIn" (prefilled
  `linkedin.com/sharing` intent URL), and a downloadable PNG badge (render the
  badge as an SVG → the client can screenshot/download; a server PNG is a Phase-4
  nicety, not required for v1). Badges are a **growth loop** — every shared badge
  is branded inbound traffic, so keep the free tier able to earn at least the
  Bronze badge.

---

## 3. Role-Specific Interview Prep

### 3.1 Dynamic question generation

Same generate-then-cache architecture as the Skills Lab, different prompt and a
different UI (practice, not scored).

```
POST /api/interview/questions  { kind: 'behavioral'|'technical', count? }   (auth)
  → getUserProfession(email)
  → cacheKey = sha256(profId|seniority|kind|PROMPT_VERSION)
  → interview_cache hit? return : generate (claude-haiku-4-5) → validate → cache
  → return { questions:[ { id, kind, prompt, framework, modelAnswer } ] }
```

**Sample prompt (behavioral):**

```
SYSTEM: You are an interview coach. Output ONLY valid JSON.
USER: Generate 8 behavioral interview questions a hiring manager would realistically
ask a Senior Registered Nurse. For each, provide:
  - "prompt": the question
  - "framework": the recommended answer structure (e.g., STAR) with role-specific guidance
  - "modelAnswer": a concise 3–4 sentence example answer tailored to this role
  - "watchFor": one common mistake candidates make on this question
Return: { "questions": [ { "id":1, "kind":"behavioral", "prompt","framework","modelAnswer","watchFor" }, ... ] }
```

Technical variant asks for role-appropriate technical/scenario questions
(clinical scenarios for a nurse, system-design for an engineer, code-of-conduct
for a paralegal, etc.). `professions.json` can carry a `technicalStyle` hint per
category to steer this.

### 3.2 Practice mode

- The UI shows **one question at a time**. The framework, model answer, and
  "watch for" are **hidden behind a "Reveal" button** — the user first types (or
  just thinks through) their own answer, then reveals to self-compare. This is
  the core loop and it costs **zero extra API calls** (everything came in the
  initial cached batch).
- Optional (Pro, Phase 3+): "Score my answer" posts the user's typed answer to
  Claude for feedback. This is a *per-answer* Sonnet call — expensive — so it is
  **Pro-only and rate-limited** (see §9).

### 3.3 Progress + confidence ratings

```
interview_progress
  id            INTEGER PK AUTOINCREMENT
  email         TEXT NOT NULL
  profession_id TEXT NOT NULL
  question_hash TEXT NOT NULL      -- sha256(prompt) so it survives cache regen
  confidence    INTEGER            -- 1..5, user self-rating after reveal
  practiced_at  INTEGER NOT NULL
  UNIQUE(email, question_hash)     -- upsert: keep latest confidence
```

After revealing, the user taps a 1–5 confidence chip. The Dashboard shows
"Interview readiness: 12/20 questions practiced, avg confidence 3.4/5" and
surfaces the lowest-confidence questions as "practice these next". No LLM needed
for any of this — it's pure aggregation over the local table.

---

## 4. Job Finder (Profession-Integrated)

### 4.1 JSearch API integration

[JSearch](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) (RapidAPI)
aggregates Google-for-Jobs listings. Integrate as a **backend proxy** — the
RapidAPI key never touches the client.

```
GET /api/jobs/search  ?query=&location=&remote=&page=          (auth required)
  1. rate-limit  (jobSearchLimiter, per-user)
  2. build query: if no explicit query, use getUserProfession(email).label
  3. cacheKey = sha256(query|location|remote|page)
  4. job_cache fresh (< JOB_CACHE_TTL, e.g. 6h)? → serve cached
  5. else fetch https://jsearch.p.rapidapi.com/search  (headers: X-RapidAPI-Key)
  6. normalize → { jobs:[ { id, title, company, location, remote, postedAt,
                            url, descriptionSnippet, applyUrl } ], page }
  7. store in job_cache with fetched_at
  8. return
```

**Rate limiting + cost control:** JSearch bills per request and free plans cap
monthly calls. Two guards:
- **Server cache with TTL** (`job_cache` table, 6-hour freshness) — identical
  searches (very common: everyone searching "Registered Nurse / Chicago") hit
  cache, not the API.
- **Per-user limiter** (`jobSearchLimiter`) + a **daily free-tier quota** via the
  existing `usage_store` (`type='jobsearch'`).

```
job_cache
  cache_key   TEXT PRIMARY KEY
  payload     TEXT NOT NULL      -- normalized JSON
  fetched_at  INTEGER NOT NULL
```

### 4.2 Auto-filtering by saved profession

On first open with no query, the search is pre-seeded from
`getUserProfession(email)` — profession label as `query`, and (if we later add
it) a saved location on `check_ins`. The user sees results immediately for
"their" role and can refine. A "Filter to my profession" toggle stays on by
default.

### 4.3 Save Job bookmarks

```
saved_jobs
  id            INTEGER PK AUTOINCREMENT
  email         TEXT NOT NULL
  job_id        TEXT NOT NULL      -- JSearch job id (dedupe key)
  title         TEXT
  company       TEXT
  location      TEXT
  url           TEXT
  snapshot      TEXT               -- JSON of the normalized job at save time
  saved_at      INTEGER NOT NULL
  UNIQUE(email, job_id)
```

Endpoints: `POST /api/jobs/save`, `GET /api/jobs/saved`, `DELETE /api/jobs/saved/:id`.
We snapshot the listing because JSearch results expire — the bookmark must
survive the listing going stale, and the snapshot feeds directly into the Gap
Analyzer (§5) with no re-fetch.

### 4.4 Cross-selling sidebar

Beside results, a contextual card driven by the user's profession + their state:

- If they haven't taken the Skills Lab test →
  **"Take the Registered Nurse Skills Test before you apply →"**
- If a job is open/selected →
  **"Analyze this job against your resume →"** (deep-links to the Gap Analyzer
  with the job pre-loaded).
- If no tailored resume exists for this role →
  **"Tailor your resume to this job →"** (routes to the existing `/api/tailor`
  flow with the job description prefilled).

This sidebar is the connective tissue that makes the Hub feel unified rather than
five separate tools.

---

## 5. Skills Gap Analyzer

### 5.1 What it compares

Input A = the user's résumé/profile (from `saved_resumes`, or pasted, or their
LinkedIn-imported profile). Input B = a job description (pasted **or** a saved
job's `snapshot` from §4.3). Output = a structured, actionable gap report.

### 5.2 LLM-powered analysis

This is the one tool where reasoning quality justifies **`claude-sonnet-4-6`**
(the model the product already uses for tailoring/ATS). It is also the most
expensive per call, so it is the most tightly gated (§9).

```
POST /api/skills-gap  { resume?, resumeId?, jobText?, savedJobId? }   (auth)
  1. resolve résumé text (resumeId → saved_resumes, or raw resume)
  2. resolve job text (savedJobId → saved_jobs.snapshot, or raw jobText)
  3. free-tier quota check (usage_store type='gap')  OR  isSubscriber
  4. cacheKey = sha256(resumeHash | jobHash | PROMPT_VERSION)   -- identical
     resume+job pair never re-bills
  5. gap_cache hit? return : anthropic (sonnet) → validate JSON → cache
  6. return report
```

**Sample prompt:**

```
SYSTEM: You are a career coach and ATS expert. Compare a candidate's resume to a
target job. Output ONLY valid JSON. Be specific and actionable — name exact skills,
tools, and keywords from the job description.

USER:
RESUME:
<<<resume text (truncated to ~4000 chars)>>>

TARGET JOB:
<<<job description (truncated to ~4000 chars)>>>

Return JSON:
{
  "matchScore": <0-100>,
  "strengths":  [ "skills/experience the candidate already has that the job wants" ],
  "gaps": [
    { "requirement": "the missing/weak requirement",
      "severity": "critical|important|nice-to-have",
      "evidence": "why it's a gap (absent from resume / underweighted)",
      "action":  "one concrete thing to do about it" }
  ],
  "quickWins":  [ "resume-wording changes that close a gap immediately" ],
  "studyPlan":  [ { "skill":"…", "how":"specific resource type or path", "estWeeks": <n> } ]
}
```

### 5.3 How it connects the data

```
 resume (saved_resumes / paste / LinkedIn)  ─┐
                                             ├─►  Sonnet gap prompt  ─►  gap report
 job requirements (saved_jobs.snapshot /  ───┘                              │
                   pasted JD)                                               ▼
                                                        ┌───────────────────────────────┐
                                                        │ actionable checklist:          │
                                                        │  • quickWins  → back to Tailor │
                                                        │  • gaps       → Skills Lab topic│
                                                        │  • studyPlan  → Dashboard tasks│
                                                        └───────────────────────────────┘
```

The report is not a dead-end: each `studyPlan` skill can propose a matching
Skills Lab topic; each `quickWin` links to the resume Tailor with the suggestion;
the whole report is saved and surfaced on the Dashboard as "your top 3 gaps for
[saved job]".

```
gap_reports
  id          INTEGER PK AUTOINCREMENT
  email       TEXT NOT NULL
  resume_id   INTEGER            -- nullable
  job_id      TEXT               -- nullable (saved_jobs.job_id)
  match_score INTEGER
  payload     TEXT NOT NULL      -- full JSON report
  created_at  INTEGER NOT NULL
  INDEX (email)
```

---

## 6. Career Hub Dashboard

A single tab (`showTab('career')`) that aggregates everything above — **read-only
composition, mostly local queries, one cheap "next steps" derivation.**

```
┌──────────────────────────────────────────────────────────────────────┐
│  Career Hub — Registered Nurse (Senior)                     ✎ change  │
├───────────────┬───────────────┬──────────────┬───────────────────────┤
│ RESUME         │ SKILLS         │ INTERVIEW     │ JOBS                  │
│ ✅ 2 tailored  │ 🥇 Gold: Safety│ 12/20 practiced│ 3 saved               │
│ Last: 3d ago   │ 🥈 Silver: Meds│ conf 3.4/5     │ 5 new matches today   │
├───────────────┴───────────────┴──────────────┴───────────────────────┤
│  TOP SKILLS GAPS (from last analysis vs. "ICU Nurse @ Mercy")         │
│   🔴 BLS/ACLS certification not shown        → add to resume          │
│   🟠 EPIC EHR experience underweighted       → quick win              │
│   🟡 Charge-nurse leadership                  → study plan (4 wks)     │
├──────────────────────────────────────────────────────────────────────┤
│  RECOMMENDED NEXT STEPS                                                │
│   1. Take the "Critical Care" Skills Test (you haven't yet)           │
│   2. Practice your 6 lowest-confidence interview questions            │
│   3. Tailor your resume to your newest saved job                      │
└──────────────────────────────────────────────────────────────────────┘
```

- **Data sources:** `check_ins` (profession), `saved_resumes` (count/recency),
  `skill_attempts` (best bands), `interview_progress` (practiced/confidence),
  `saved_jobs` (count), `gap_reports` (latest top gaps).
- **`GET /api/career/dashboard`** returns one composed JSON object built from
  those queries — no LLM call.
- **Next steps:** rule-based first (cheap, deterministic): "no skills test yet →
  suggest it", "gap severity=critical → surface it", "saved job with no gap
  report → suggest analysis". A Pro **"AI coach summary"** (one Haiku call that
  turns the state into a 2-sentence motivational nudge) is an optional garnish,
  cached per-day per-user so it bills at most once/day.

---

## 7. Technical Considerations

### 7.1 API keys and estimated costs

| Service | Env var | Purpose | Notes |
|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` *(already set)* | Quizzes, interview Qs, gap analysis, coach summary | **Reuse existing key.** No OpenAI. |
| JSearch (RapidAPI) | `RAPIDAPI_KEY` *(new)* | Job listings | New signup. Free tier ~200 req/mo; Pro plans ~$25–75/mo for 10k–75k req. |

**Recommendation: stay Anthropic-only.** The codebase already standardizes on
`anthropic.messages.create`. Adding OpenAI would mean a second SDK, a second key,
a second billing surface, and split prompt-engineering — for no quality gain on
these tasks. Use **`claude-haiku-4-5`** for high-volume generative tasks
(quizzes, interview questions, coach summary) and **`claude-sonnet-4-6`** only
for the Gap Analyzer.

**LLM cost model (order-of-magnitude, USD):**

| Call | Model | Tokens in/out (approx) | Cost/call | Frequency after caching |
|---|---|---|---|---|
| Quiz generation | Haiku | ~800 / ~1,500 | ~$0.005 | **Once per profession/topic, ever** (then $0) |
| Interview Qs | Haiku | ~600 / ~1,800 | ~$0.006 | **Once per profession/kind, ever** |
| Gap analysis | Sonnet | ~2,500 / ~1,200 | ~$0.03 | Per unique (resume,job) pair; cached |
| "Score my answer" (Pro) | Sonnet | ~700 / ~500 | ~$0.012 | Per submission, Pro + rate-limited |
| Coach summary (Pro) | Haiku | ~400 / ~120 | ~$0.001 | ≤ once/user/day (cached) |

Because quizzes and interview questions are **cached across the entire user
base**, their marginal cost trends to zero: the whole quiz catalog (~2,400
variants) costs **under $15 to fully warm** and then bills nothing. The real
variable cost is the **Gap Analyzer** (unique inputs, harder to cache across
users) — which is exactly why it's the tightest-gated Pro feature (§9).

### 7.2 Rate limiting & caching strategy (summary)

- **Rate limiters** (`express-rate-limit`, mirroring `tailorLimiter`):
  `skillsLabLimiter` (10/min), `interviewLimiter` (10/min),
  `jobSearchLimiter` (15/min), `gapLimiter` (5/min).
- **Content caches** (persistent SQLite tables): `quiz_cache`, `interview_cache`,
  `gap_cache`, `job_cache`. Keyed by content hash + `PROMPT_VERSION`. Bumping
  `PROMPT_VERSION` is how we invalidate everything after a prompt change.
- **Anthropic prompt caching** (`cache_control`) on the big static system prompts
  for the cold path.
- **Daily free quotas** via existing `usage_store` (`type` ∈
  `quiz|interview|jobsearch|gap`).

### 7.3 Database schema changes (all additive)

**Columns on `check_ins`:** `profession_id`, `profession_cat`, `seniority`,
`profession_set_at`.

**New tables:** `quiz_cache`, `skill_attempts`, `badges`, `interview_cache`,
`interview_progress`, `job_cache`, `saved_jobs`, `gap_cache`, `gap_reports`.

All created with `CREATE TABLE IF NOT EXISTS` at boot; all column adds via
`_ensureColumn()` — same pattern as the rest of `server.js`, zero-downtime,
no manual migration.

### 7.4 Pro vs. free gating (mechanism)

Reuse `isSubscriber(email)` and `usage_store`. Standard pattern per gated route:

```js
const email = getSessionEmail(req);
if (!email) return res.status(401).json({ error: 'login_required' });
const pro = isSubscriber(email);
if (!pro) {
  if (!hasFreeTierLeft(getUsageKey(req), 'gap')) {          // extend helper to take a limit N
    return res.status(402).json({ error: 'pro_only', message: 'Daily free limit reached. Upgrade for unlimited.' });
  }
  consumeFreeTier(getUsageKey(req), 'gap');
}
// ...run tool...
```

(`hasFreeTierLeft`/`consumeFreeTier` currently assume a limit of 1; generalize
them to accept a per-type daily cap, or add `hasQuotaLeft(key, type, limit)`.)

### 7.5 Mobile interaction plan

The app is already a mobile-conscious SPA. New surfaces follow the same feel:

- **Bottom sheets** for the profession picker, the "save job" confirm, the badge
  share menu, and the interview "Reveal" panel — matching the existing
  `≤820px` bottom-sheet pattern used by the editor's gear inspector.
- **Swipe** through interview questions (one card per screen, swipe left/right)
  and through quiz questions.
- **Haptics:** `navigator.vibrate()` on quiz answer submit (correct = short,
  wrong = double) and on badge earn — progressive enhancement, silently absent
  where unsupported.
- **Sticky bottom action bar** on the Job Finder (Save / Analyze / Tailor) so the
  primary actions are thumb-reachable.
- All new tabs are additive `showTab()` cases; the sidebar groups them under a
  "Career Hub" heading (the existing forum/salary/checkin buttons move under it).

---

## 8. Phased Build Plan

Ordered by dependency. **Phase 1 needs no new API keys** and can start
immediately; the JSearch-dependent phase is isolated so a missing key never
blocks the rest.

### Phase 0 — Foundation *(can start immediately; no new keys)*
- `professions.json` taxonomy file (seed from existing role-page slugs).
- `check_ins` column migrations; `/api/profession` GET/POST; `getUserProfession()` + `resolveProfession()`.
- Profession picker UI (searchable modal + mobile bottom sheet).
- Career Hub sidebar grouping + empty `career` Dashboard tab shell.
- **Effort: ~2–3 days.**

### Phase 1 — Skills Lab *(no new keys; uses existing ANTHROPIC_API_KEY)*
- `quiz_cache`, `skill_attempts`, `badges` tables.
- `/api/skills-lab/quiz`, `/submit`; Haiku prompt + JSON validation + retry.
- Quiz UI (delivery, scoring, retake, explanations).
- Badge mint + `/badge/:slug` public page + share.
- Wire scores into the Dashboard.
- **Effort: ~4–5 days.** *(Highest value-for-effort; ship first.)*

### Phase 2 — Interview Prep *(no new keys)*
- `interview_cache`, `interview_progress` tables.
- `/api/interview/questions`; practice UI (reveal, confidence chips, swipe).
- Dashboard readiness widget.
- **Effort: ~3–4 days.** *(Reuses Phase 1's generate-cache-validate pattern.)*

### Phase 3 — Skills Gap Analyzer *(no new keys)*
- `gap_cache`, `gap_reports` tables.
- `/api/skills-gap` (Sonnet); résumé/job resolution from existing tables.
- Report UI + checklist + cross-links (Tailor / Skills Lab / Dashboard).
- **Effort: ~3–4 days.**

### Phase 4 — Job Finder *(REQUIRES `RAPIDAPI_KEY` / JSearch signup)*
- `job_cache`, `saved_jobs` tables.
- `/api/jobs/search|save|saved`; JSearch proxy + TTL cache + limiter.
- Results UI, save bookmarks, cross-sell sidebar (ties Phases 1/3 together).
- **Effort: ~4–5 days.** *(Blocked only on the RapidAPI key; everything else can ship without it.)*

### Phase 5 — Dashboard polish & optional AI *(no new keys)*
- Full `/api/career/dashboard` composition; rule-based next steps.
- Optional Pro "AI coach summary" (Haiku, daily-cached) and "Score my answer".
- Pre-generation warm-up script for top-20 professions.
- Mobile haptics/swipe polish; tests.
- **Effort: ~3–4 days.**

**Total: ~19–25 working days**, front-loaded so a usable Skills Lab ships at the
end of Phase 1 (~week 1.5) and each later phase is independently shippable.

---

## 9. Free vs. PRO Tier Recommendations

**Philosophy:** free tier must deliver a real "aha" (so users trust the tool and
share badges = growth), while the **expensive, repeat-use, job-search-moment**
features drive upgrades. The single most expensive variable cost is the Gap
Analyzer (unique Sonnet calls) — gate it hardest. Quizzes/interview questions are
near-free after caching, so be generous there to hook users.

| Tool | Free tier | PRO tier | Why |
|---|---|---|---|
| **Profession selector** | ✅ Full | ✅ Full | Costs nothing; it's the on-ramp for everything. Never gate it. |
| **Skills Lab** | ✅ **1 quiz/day**, all professions, earn **Bronze/Silver** badges, retake once/day | ✅ Unlimited quizzes & retakes, **Gold** badge eligibility, all topics, downloadable PNG badge | Cached ⇒ cheap, so free is generous. Gold + unlimited retakes are the aspirational upsell; shared badges feed growth. |
| **Interview Prep** | ✅ **Behavioral questions** for their profession, practice + reveal, confidence tracking | ✅ **Technical questions**, **"Score my answer" AI feedback**, unlimited kinds | Behavioral (cached, cheap) hooks them; "Score my answer" is a per-call Sonnet cost ⇒ Pro + rate-limited. |
| **Job Finder** | ✅ **5 searches/day**, results + apply links, **save up to 5 jobs** | ✅ Unlimited searches, unlimited saved jobs, "new matches" daily digest email | JSearch bills per call ⇒ cap free searches. Cache absorbs the popular queries so the free cap rarely bites real cost. |
| **Skills Gap Analyzer** | ✅ **1 analysis/week** (or 1 lifetime "try it" then weekly) | ✅ **Unlimited** analyses, saved reports, study-plan tracking | **Most expensive per call (Sonnet, uncacheable across users).** This is the flagship Pro feature and the strongest upgrade trigger — it lands exactly at the "I'm about to apply" moment. |
| **Career Dashboard** | ✅ Full view, rule-based next steps | ✅ AI coach summary, full history/trends | Aggregation is free; the AI garnish is a cheap-but-branded Pro perk. |

### 9.1 Recommended free limits (keep API cost low, value real)

| Feature | Free daily/weekly limit | Enforced via |
|---|---|---|
| Skills Lab quiz | 1/day (+1 retake/day) | `usage_store` type `quiz` |
| Interview questions (behavioral) | Unlimited *(cached ⇒ ~free)* | rate limiter only |
| "Score my answer" | Pro only | `isSubscriber` + `gapLimiter`-style |
| Job search | 5/day | `usage_store` type `jobsearch` |
| Saved jobs | 5 total | `COUNT` check on `saved_jobs` |
| Gap analysis | 1/week | `usage_store` type `gap` (7-day key) |
| Coach summary | Pro only | `isSubscriber` |

### 9.2 Pricing recommendation

**Bundle the Career Hub into the existing Pro plan — do not create a separate
tier.** Rationale:

- A second subscription ($/mo for "Career Hub") fragments the offer and tanks
  conversion; the whole pitch of this expansion is *one* unified platform.
- The existing **$19.00/mo (or $129 lifetime)** Pro already gates templates,
  video, and personal website. Career Hub Pro features (unlimited gap analysis,
  Gold badges, technical interview + answer scoring, unlimited job search) become
  **new reasons to buy the same plan** — increasing perceived value without
  raising price.
- **Optional future move:** once the Hub proves out, consider a modest price
  bump for *new* Pro signups (e.g. $22.99/mo) grandfathering existing users —
  but launch at the current price to maximize adoption and badge-driven growth.

### 9.3 Expensive features & how to minimize cost

| Feature | Cost driver | Mitigation |
|---|---|---|
| Skills Lab / Interview | 1 LLM call per generation | **Cross-user persistent cache** (`quiz_cache`/`interview_cache`) ⇒ each variant generated once ever; **Haiku** not Sonnet; optional **pre-generation** of top professions. |
| Gap Analyzer | 1 Sonnet call per unique (resume, job) | **Per-pair cache** (`gap_cache`); **weekly free cap**; Sonnet only here; truncate inputs to ~4k chars each. |
| "Score my answer" | 1 Sonnet call per answer | **Pro-only**, `answerScoreLimiter`, Haiku-first with Sonnet fallback only if needed. |
| Job Finder | 1 RapidAPI call per search | **6h TTL cache** (popular queries collapse to one call); **5/day free cap**; server-side only. |
| Coach summary | 1 Haiku call per user/day | **Cache per user per day**; Pro-only; skip if state unchanged. |

**Bottom line on cost:** with cross-user caching, the entire generative surface
(quizzes + interview questions) is effectively a **one-time few-dollar spend**.
Ongoing variable cost concentrates in (a) Gap analyses and (b) JSearch calls —
both explicitly capped for free users and unlimited only for paying Pro users,
so cost scales with revenue, not with free usage.

---

## Appendix A — New endpoints at a glance

```
GET  /api/profession
POST /api/profession
POST /api/skills-lab/quiz
POST /api/skills-lab/submit
GET  /api/skills-lab/attempts
GET  /badge/:slug                (public page)
POST /api/interview/questions
POST /api/interview/progress
POST /api/interview/score        (Pro)
POST /api/skills-gap             (weekly-capped free / unlimited Pro)
GET  /api/skills-gap/reports
GET  /api/jobs/search            (needs RAPIDAPI_KEY)
POST /api/jobs/save
GET  /api/jobs/saved
DELETE /api/jobs/saved/:id
GET  /api/career/dashboard
GET  /api/career/coach           (Pro, daily-cached)
```

## Appendix B — New/changed DB objects at a glance

```
check_ins        + profession_id, profession_cat, seniority, profession_set_at
quiz_cache       (cross-user quiz content cache)
skill_attempts   (per-user scores)
badges           (public shareable badges)
interview_cache  (cross-user question cache)
interview_progress (per-user practice + confidence)
job_cache        (JSearch response cache, TTL)
saved_jobs       (bookmarks + snapshots)
gap_cache        (per-pair gap-report cache)
gap_reports      (per-user saved reports)
```

---

*End of plan. No code has been written and no existing files were modified. Tell
me which phase to build first — Phase 0 (Foundation) + Phase 1 (Skills Lab) is
the recommended starting point, since it needs no new API keys and ships the
highest-value feature fastest.*
