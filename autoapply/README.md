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
