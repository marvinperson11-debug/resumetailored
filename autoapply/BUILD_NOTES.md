# AutoApply — build notes & response

This document is the written response to the request to build **AutoApply**, a
job-application auto-fill assistant. The full working code is in this
`autoapply/` folder; this file explains what was built, the key decisions, how
it maps to the spec, and what a follow-up would add.

## Where it lives (and why)

AutoApply is a **standalone Next.js 14 project under `autoapply/`**, deliberately
isolated from the ResumeTailored Express/SQLite app at the repo root. The two
share nothing at runtime — different stack (Next vs Express), different DB
(PostgreSQL/Prisma vs SQLite), different auth (NextAuth/Google vs custom
bcrypt sessions). Keeping AutoApply in its own folder means its `package.json`,
`node_modules`, build, and tooling never collide with the root app.

## What was built (maps 1:1 to the spec)

### 1. Dashboard (Next.js 14, App Router, TS, Tailwind, shadcn-style)
- **Auth-protected** `/dashboard/*` via `src/middleware.ts` + NextAuth Google OAuth.
- **Profile** (`/dashboard/profile`): resume PDF upload (parsed to text client-side
  with pdf.js, then GPT-4o → structured JSON), job preferences, and
  **extension-token** management.
- **Job Queue** (`/dashboard`): table with Company · Role · Match Score · Status ·
  Actions; **Add Job** dialog (paste URL + description); per-row **Score**,
  **Prepare**, **View**, **Apply**, delete.

### 2. AI tailoring (OpenAI GPT-4o, JSON mode)
- `src/lib/ai.ts`: `parseResumeText`, `scoreMatch` (0–100 + skills/experience/domain
  breakdown + missing keywords), `prepareApplication` (tailored resume, cover
  letter, suggested answers). All use `response_format: json_object`.
- Guardrail baked into prompts: **never fabricate** experience/dates/credentials.

### 3. Browser extension (Manifest V3, Vite + CRXJS, React popup + TS content scripts)
- **Detects** LinkedIn Easy Apply, Greenhouse, Lever, Workday (`src/content/adapters/*`).
- On dashboard **Apply**: page → `dashboard-bridge` content script → `background`
  worker opens the job tab and records the assignment; the **ATS content script**
  fetches `apply-data`, runs the matching adapter, and fills fields.
- **Highlights** filled fields green; shows a **floating card** ("N fields
  auto-filled — review and submit") with a **mark Applied** sync button.
- **Never submits.** Work-authorization / EEO / legal questions are never auto-answered.

### 4. Database (Prisma + PostgreSQL)
- `User`, `JobApplication` (as specified) + NextAuth adapter tables + an
  `ExtensionToken` table (hashed bearer tokens for the cross-origin extension).
- `ApplicationStatus` is a proper enum (`NEW → PREPARED → APPLIED`).

## Key decisions

- **Extension auth = hashed bearer token**, not the browser cookie: the extension
  runs on the *employer's* origin, so a cookie won't travel. The token is shown
  once, stored only in `chrome.storage.local`, and only its SHA-256 hash is in the
  DB. Extension-facing endpoints are CORS-scoped to `EXTENSION_ORIGINS`.
- **Assignment lifecycle in the background worker**, keyed by tab id in
  `chrome.storage.session` — content scripts can't read session storage directly,
  so they ask the worker. Survives worker suspension; cleared on tab close.
- **Generic filler + thin adapters**: `filler.ts` matches fields by label/name/
  placeholder/aria and sets values React-compatibly (native setter + input/change
  events). Adapters add platform-specific selectors (Greenhouse ids, Lever
  `name=`, Workday `data-automation-id`) then fall back to the generic engine.
- **SPA-aware**: a debounced `MutationObserver` re-runs fill as LinkedIn steps and
  Workday sections mount lazily.
- **Client-side PDF parsing** (pdf.js from CDN) keeps binary handling out of the
  server; the API only ever receives text.

## Verification

- `autoapply`: `tsc --noEmit` clean; `next build` succeeds (all 10 routes compile).
- `extension`: `tsc --noEmit` clean; `vite build` produces a loadable MV3 bundle.
- `next` pinned to **14.2.35** (patched; 14.2.7 carried a security advisory).
- OpenAI client is lazy-instantiated so a missing key never breaks the build.

See `README.md` (this folder) for full setup and `extension/README.md` for the
extension. Both include the exact commands.

## Not done yet (explicit follow-ups)

- **Job aggregation/scraping** — today jobs are added manually (as the spec's
  starting point requests). A scraping/import layer is the next milestone.
- **Multi-entry work/education fill** on long ATS forms is best-effort; per-entry
  repeat-group handling can be deepened per platform.
- **Tailored-resume file export** (PDF/DOCX) and résumé attachment upload.
- **More adapters** (Ashby, iCIMS, Taleo).
- No automated tests yet — the ATS adapters especially would benefit from DOM
  fixtures per platform.
