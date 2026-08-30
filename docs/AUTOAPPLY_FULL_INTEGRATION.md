# AutoApply — full integration status & report

Branch: `claude/auto-applyer-integration-at0p0d` · PR: [#422](https://github.com/marvinperson11-debug/resumetailored/pull/422)
(builds on **#421**, already merged to `main` and deployed to Railway)

Most of this request was already delivered across #421 (merged) and #422 (open).
This pass verified every section end-to-end and closed the one real gap — the
**Job Finder had no dedicated landing page**. Below is the status of each section
and the report-back.

## Section-by-section status

| Section | Status | Where |
|---|---|---|
| 1. Find & surface AutoApply | ✅ done | landing `public/tools/autoapply.html` (`/tools/autoapply`); homepage card + nav + footer + llms.txt (#421) |
| 2. Job Finder ↔ server-side queue | ✅ done | `apply_queue` table + 6 routes in `server.js`; Job Finder button + "My Apply Queue" panel + 12s poll + 401 prompt, no localStorage (#421) |
| 3. Bridge the standalone app | ✅ done | `applyQueueEmail()` service token, proxy routes, status mapping, `sourceQueueId` + migrations, extension count (#422) |
| 4. Landing page for every tool | ✅ done **this pass** | all existed except **Job Finder** → created `public/job-finder.html` |
| 5. Navigation & cross-linking | ✅ done | `related-tools.js` on all tool pages; nav/footer; `/score` hub |
| 6. Deployment safety | ✅ done | startup warnings both apps, smoke test, status pill, README checklist (#422) |
| 7. Verification | ✅ green | tests + smoke test below |

## 1. Where the AutoApply tool lives

- **Landing page:** `public/tools/autoapply.html` → **`/tools/autoapply`** (shows the
  signed-in user's live queue count).
- **The app + extension:** `autoapply/` — a standalone Next.js 14 app (Prisma +
  Postgres, NextAuth/Google) and a Manifest V3 Chrome extension
  (`autoapply/extension/`). Separate deployment; bridged to the main app (Section 3).

## 2. Landing pages: existed vs. created

**All 19 now have a dedicated page.** Existed already: ATS Score Checker
(`/ats-score-checker`), Readability Review (`/resume-analyzer`), ATS Keyword
Extractor, AI Resume Tailor, AI Cover Letter Generator, LinkedIn Optimizer
(`/linkedin-optimizer`), Job Application Tracker (`/job-tracker`), Share Resume as
a Link (`/share-resume-link`, created in #421), Resume/Cover-Letter Examples,
Salary Negotiation, Resume A/B Tracker, Offer Comparison, Job Description Decoder,
Weekly Report, Follow-Up Generator, AI Mock Interview, AutoApplyer
(`/tools/autoapply`).

**Created this pass:** `public/job-finder.html` → **`/job-finder`** — SEO
title/description, H1, value-prop paragraphs, a 4-step "How it works", a feature
grid, a "Free with a ResumeTailored account" CTA to the app, EN + Simplified-
Chinese i18n, and the shared **Related Tools** block. `related-tools.js`, `llms.txt`,
the nav, the homepage menus/footer, and the `/score` hub now point at it (they
previously linked Job Finder to `/dashboard`).

> Note on "100% Free · No Account Required": the Job Finder runs inside the Career
> Hub, which **does** require a (free) sign-in, so the page honestly says "Free with
> a ResumeTailored account" rather than "No Account Required".

## 3. Auth / database / API changes

- **DB (`server.js`):** `apply_queue` table (id, email, job_url, job_title,
  company_name, job_board, status, resume_id, cover_letter, form_data, created_at,
  updated_at, `UNIQUE(email, job_url)`) + `idx_apply_queue_email` — exactly the
  requested schema.
- **API:** `POST /api/apply-queue`, `POST /api/apply-queue/batch`,
  `GET /api/apply-queue?status=`, `GET /api/apply-queue/count`,
  `PATCH /api/apply-queue/:id`, `DELETE /api/apply-queue/:id`.
- **Auth:** all six gated by `applyQueueEmail()`, which accepts a normal session
  **or** a trusted service call (`x-rt-service-token` matching `RT_SERVICE_TOKEN`,
  constant-time compare, + `x-rt-user-email`). No new auth system — the main app
  already had bcrypt sessions.

## 4. How the Job Finder integration works

`public/career-hub.js` (Career Hub → Job Finder): each search result and feed job
has an **⚡ Auto-Apply** button → `POST /api/apply-queue` (401 → sign-in prompt).
The **My Apply Queue** panel reads `GET /api/apply-queue`; remove → `DELETE`. The
panel **polls every 12s** while the Job Finder is open, so a job added on another
device appears without a refresh. The queue is server-side (`apply_queue`), not
localStorage.

## 5. How the standalone-app bridge works

The two apps share no session store but share the user's **email**. The standalone
app calls the main app as a trusted service (`x-rt-service-token` +
`x-rt-user-email`); the secret stays server-side. Proxy routes
(`autoapply/src/app/api/apply-queue/*`) forward reads/writes; an `import` route
pulls the main queue into local `JobApplication` rows (records `sourceQueueId`) so
Score/Prepare/Apply work; status changes write back (NEW↔queued,
PREPARED↔auto_filled, APPLIED↔submitted; fallback `manual_needed`). Migrations:
`prisma/migrations/0_init` + `…_add_source_queue_id` + `db:migrate` script. The
extension shows the queue count via the proxy.

## 6. Test results

- **Main `test/*.js` — green** (0 failures; `production-e2e` SKIPs on Node 22).
- **`autoapply/test/queue-sync.test.mjs` — 25/25 pass.**
- **`autoapply` + extension `tsc --noEmit` — clean.**
- **Smoke test — 7 PASS / 0 FAIL / 1 SKIP** (skip = standalone-only import step):
  `node scripts/smoke-test-autoapply-bridge.js --main-url http://localhost:3000 --service-token <token>`
- **Routes** (booted dev server): `/job-finder`, `/tools/autoapply`,
  `/related-tools.js` → 200; `/api/apply-queue/count` → 401 unauthenticated
  (correct); homepage + `/score` + nav link Job Finder; `/job-finder` renders the
  Related Tools block.

## 7. Issues / follow-ups

- **Live two-process run** (dashboard + Postgres + Google OAuth) isn't possible in
  this sandbox, so the smoke test's service-bridge steps + full typechecks stand in
  for it. The `import` / real-proxy steps run once you point the script at a
  deployed standalone app with an extension token.
- **Deploying the bridge:** set `RT_SERVICE_TOKEN` on the main app, and the **same**
  token + `RT_MAIN_APP_URL` on the standalone app, then `npm run db:migrate`. The
  dashboard's status pill turns green ● Synced when it's wired. (Checklist in
  `autoapply/README.md`.)
- **Existing tool landing pages** were authored earlier and already carry SEO
  title/description, an H1, and the Related Tools block. I did not rewrite all 18 to
  a single strict template — say the word if you want them normalized to the exact
  "How it works + 100% Free" structure and I'll do a dedicated pass.
