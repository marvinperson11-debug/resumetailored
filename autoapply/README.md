# AutoApply

A job-application **auto-fill assistant**. Review matched postings in a dashboard,
let AI score your fit and tailor your resume, click **Apply**, and a browser
extension auto-fills the application form on the employer's site
(LinkedIn Easy Apply, Greenhouse, Lever, Workday).

**You stay in control** — the system fills fields and highlights them, but
**never submits**. You review and hit Submit on the employer's page yourself.

> This lives in the `autoapply/` subfolder and is a standalone Next.js app,
> independent of the ResumeTailored Express app at the repo root.

## Architecture

```
autoapply/                Next.js 14 dashboard + API (this app)
  src/app/                App Router pages + API routes
  src/components/         Dashboard UI (shadcn-style)
  src/lib/                Prisma, NextAuth, OpenAI, types, helpers
  prisma/schema.prisma    PostgreSQL schema
extension/                Manifest V3 Chrome extension (Vite + CRXJS)
  src/background/         Service worker (assignment lifecycle)
  src/content/            Dashboard bridge + ATS content script + adapters
  src/popup/              React popup (token + dashboard URL)
```

| Layer | Tech |
|---|---|
| Dashboard | Next.js 14 (App Router), TypeScript, Tailwind, shadcn-style UI |
| API | Next.js Route Handlers + Prisma ORM |
| DB | PostgreSQL |
| Auth | NextAuth.js (Google OAuth) |
| AI | OpenAI GPT-4o (JSON mode) — parse resume, match score, tailor |
| Extension | Manifest V3, React popup + TS content scripts |

## Data flow

1. **Profile** — upload a resume PDF (parsed client-side to text, then GPT-4o →
   structured JSON), set job preferences, and generate an **extension token**.
2. **Add job** — paste a posting URL + description.
3. **Score** — `POST /api/jobs/:id/score` → GPT-4o returns 0–100 + breakdown.
4. **Prepare** — `POST /api/jobs/:id/prepare` → tailored bullets, cover letter,
   and suggested answers, stored on the job.
5. **Apply** — the dashboard posts an `APPLY` message the extension picks up;
   the extension opens the job URL, reads `GET /api/jobs/:id/apply-data`
   (bearer token), and auto-fills the form.
6. **Sync** — after you submit on the employer site, click **mark Applied** in
   the extension's floating card → `POST /api/jobs/:id/apply-data` → status
   becomes `APPLIED`.

## Setup

### 1. Dashboard

```bash
cd autoapply
cp .env.example .env        # fill DATABASE_URL, NEXTAUTH_SECRET, Google OAuth, OPENAI_API_KEY
npm install
npx prisma migrate dev --name init   # or: npm run db:push
npm run dev                 # http://localhost:3000
```

Google OAuth: create credentials at <https://console.cloud.google.com/apis/credentials>
with redirect URI `http://localhost:3000/api/auth/callback/google`.

### 2. Extension

```bash
cd extension
npm install
npm run build               # outputs extension/dist
```

Load `extension/dist` at `chrome://extensions` → **Load unpacked**. Copy the
extension ID it prints into the dashboard's `EXTENSION_ORIGINS`
(`chrome-extension://<id>`) and restart the dashboard. Open the popup, set the
dashboard URL and paste your extension token.

### 3. Database — first-time / upgrade

The schema is managed with Prisma. Two supported paths:

```bash
# Production / CI (safe, versioned): applies prisma/migrations in order.
npm run db:migrate        # = prisma migrate deploy

# Local quick dev (no migration history): pushes the schema straight to the DB.
npm run db:push           # = prisma db push
```

**Upgrading an existing database** (adds the apply-queue bridge's
`JobApplication.sourceQueueId` column):

- If you use migrations: `npm run db:migrate` applies
  `prisma/migrations/…_add_source_queue_id` (idempotent — `ADD COLUMN IF NOT
  EXISTS`).
- If your existing DB was created with `db push` (no migration history) and you
  want to adopt migrations, baseline the initial migration once, then deploy:
  ```bash
  npx prisma migrate resolve --applied 0_init
  npm run db:migrate
  ```
- Or simply run `npm run db:push` again — it adds the new nullable column
  non-destructively.

## API routes

| Method | Route | Purpose | Auth |
|---|---|---|---|
| `*` | `/api/auth/[...nextauth]` | NextAuth (Google) | — |
| `GET/PUT` | `/api/profile` | resume data + preferences | session |
| `POST` | `/api/resume/parse` | text → structured resume | session |
| `GET/POST` | `/api/jobs` | list / add jobs | session |
| `GET/PATCH/DELETE` | `/api/jobs/:id` | read / status / delete | session |
| `POST` | `/api/jobs/:id/score` | AI match score | session |
| `POST` | `/api/jobs/:id/prepare` | tailor + cover letter | session |
| `GET/POST` | `/api/jobs/:id/apply-data` | extension read / sync applied | token or session |
| `GET/POST/DELETE` | `/api/extension-token` | manage extension tokens | session |

## Security notes

- The extension authenticates with a hashed bearer token (only the SHA-256 hash
  is stored); the raw token is shown once and lives only in the extension's
  `chrome.storage.local`.
- The extension-facing endpoints are CORS-scoped to the extension origins in
  `EXTENSION_ORIGINS`.
- Legal / work-authorization / EEO questions are **never** auto-answered.
- Nothing is ever submitted automatically.

## Roadmap

- Job aggregation/scraping layer (today: manual paste).
- Résumé file upload to storage + DOCX/PDF export of the tailored resume.
- More ATS adapters (Ashby, iCIMS, Taleo) and richer multi-entry work/education fill.

## Hand-off with the main ResumeTailored app (apply queue — source of truth)

As of the cross-device apply-queue work, the **main app** (`../server.js`) owns a
persistent, account-scoped apply queue at **`/api/apply-queue`** — this is now the
source of truth for "jobs a user wants to apply to". The Job Finder in the main
app (`public/career-hub.js`) writes to it, and the AutoApply landing page reads
its count from it.

Main-app endpoints (all require the main app's signed-in session; email-keyed):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/apply-queue` | add one job (`{ job_url, job_title, company_name, job_board?, resume_id? }`) |
| `POST` | `/api/apply-queue/batch` | add many (`{ jobs: [...] }`) |
| `GET` | `/api/apply-queue?status=` | list the user's queue (optionally by status) |
| `GET` | `/api/apply-queue/count` | `{ count, queued }` |
| `PATCH` | `/api/apply-queue/:id` | update `status` / `formData` / `coverLetter` / `resumeId` |
| `DELETE` | `/api/apply-queue/:id` | remove one |

`status ∈ { queued, auto_filled, submitted, manual_needed, archived }`.

### How the two apps are wired together

The main app's queue is the **source of truth**. This app reads from it, imports
those jobs so its Score/Prepare/Apply flows can run on them, and writes status
changes back — so the queue stays in sync across the website, this dashboard, and
the extension.

**Auth hand-off (the bridge).** The two apps share **no session store** — the
main app uses its own bcrypt sessions, this app uses NextAuth (Google). What they
*do* share is the user's **email**. So this app authenticates to the main app as a
trusted first-party **service**: every call sends `x-rt-service-token: <shared
secret>` and `x-rt-user-email: <the signed-in user's email>`. The main app's
`/api/apply-queue*` routes accept this in `applyQueueEmail()` (server.js) when its
`RT_SERVICE_TOKEN` is set and matches (constant-time compare); otherwise they fall
back to a normal browser session. The secret lives only on this app's server
(`RT_SERVICE_TOKEN` / `RT_MAIN_APP_URL` env) — it is **never** sent to the browser
or the extension, which talk only to this app's proxy routes.

**What this app added:**

- `src/lib/queue-sync.js` — pure status maps + payload normalization (unit-tested
  in `test/queue-sync.test.mjs`).
- `src/lib/main-app-queue.ts` — server client: `fetchMainQueue`, `mainQueueCount`,
  `addToMainQueue`, `updateMainStatus`. No-ops when the bridge env is unset.
- `src/lib/api-identity.ts` — resolves the acting email from the NextAuth session
  **or** a bearer ExtensionToken (so the extension can use the proxy too).
- Proxy routes (secret stays server-side):
  - `GET /api/apply-queue` — the user's live main-app queue.
  - `POST /api/apply-queue` — add a job to the main queue.
  - `PATCH /api/apply-queue/:id` — write a status change back.
  - `GET /api/apply-queue/count` — `{ count, queued }` (dashboard banner + popup).
  - `POST /api/apply-queue/import` — pull the main queue into local
    `JobApplication` rows so Score/Prepare/Apply work; idempotent, matches on
    `(userId, jobUrl)` and records `sourceQueueId`.
- **Status write-back:** when a local job (that has a `sourceQueueId`) advances,
  `syncStatusToMain()` PATCHes the main queue — from `prepare` (→ PREPARED) and
  from the extension's "Sync status" (→ APPLIED). Best-effort: a failure is logged,
  never blocks the local action.
- **Extension:** `fetchQueueCount` / `addToQueue` (extension/src/lib/api.ts) call
  this app's proxy with the bearer ExtensionToken; the popup shows the queue count.

**Status mapping** (the local enum is coarser than the main one):

| local (this app) | → main (write-back) | main → local (read/import) |
| --- | --- | --- |
| `NEW` | `queued` | `queued`, `manual_needed` → `NEW` |
| `PREPARED` | `auto_filled` | `auto_filled` → `PREPARED` |
| `APPLIED` | `submitted` | `submitted`, `archived` → `APPLIED` |

Anything unmapped writes back as `manual_needed` (the spec's fallback).

**Config.** Set `RT_MAIN_APP_URL` + `RT_SERVICE_TOKEN` here and the **same**
`RT_SERVICE_TOKEN` on the main app (see both `.env.example`s). Leave them unset and
the bridge disables cleanly — this app falls back to its own local job list, the
banner shows nothing synced, and no calls are made to the main app. The
`sourceQueueId` column is added to `JobApplication` (run `prisma db push` or a
migration after pulling).

### Deploying the bridge (checklist)

- [ ] Set `RT_SERVICE_TOKEN` on the **main app** (Railway env). It logs
      `[AutoApply Bridge] RT_SERVICE_TOKEN set …` at boot when present, or
      `RT_SERVICE_TOKEN not set — … session-only mode` when missing.
- [ ] Set `RT_SERVICE_TOKEN` **+** `RT_MAIN_APP_URL` on the **standalone app**
      (Vercel/Railway env). It logs `[AutoApply Bridge] configured → <url>` at
      boot (see `src/instrumentation.ts`), or a warning naming the missing vars.
- [ ] **Verify the two `RT_SERVICE_TOKEN` values match exactly.**
- [ ] Run `npm run db:migrate` (or `npm run db:push`) in the standalone app to
      add `JobApplication.sourceQueueId`.
- [ ] Run the smoke test (below) → all steps PASS.
- [ ] Open the AutoApply dashboard → the header shows a green **● Synced** badge
      (not **● Bridge offline** / **● Bridge not configured**).

### Smoke test

`scripts/smoke-test-autoapply-bridge.js` (in the repo root) drives the whole
bridge against a **running** main app: it creates a test user, adds a job, reads
it back as the standalone service, writes status back (auto_filled → submitted),
and cleans up. It points at running instances (it does not boot them).

```bash
# from the repo root, with the main app running:
node scripts/smoke-test-autoapply-bridge.js \
  --main-url http://localhost:3000 \
  --service-token "$RT_SERVICE_TOKEN"

# add the real standalone-proxy checks (import) too:
node scripts/smoke-test-autoapply-bridge.js \
  --main-url https://resumetailored.com --service-token "$RT_SERVICE_TOKEN" \
  --standalone-url https://autoapply.example.com --extension-token aa_xxx
```

Exit code 0 = all executed steps passed. The `import` step is skipped unless
`--standalone-url` **and** `--extension-token` are given (the standalone proxy is
auth-gated); the service-bridge read/write steps prove the same server-to-server
calls the import uses.
