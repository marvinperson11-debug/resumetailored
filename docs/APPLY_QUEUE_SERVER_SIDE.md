# AutoApply queue → persistent, server-side, cross-device

Branch: `claude/auto-applyer-integration-at0p0d` · PR: [#421](https://github.com/marvinperson11-debug/resumetailored/pull/421)

Upgrades the Job Finder's Auto-Apply queue from per-browser `localStorage` to a
**persistent, account-scoped, cross-device** queue served by the main app.

## 1. What auth existed vs. what I built

**Auth already existed — nothing new was built.** The main app (`server.js`) already has:

- **Accounts**: `users` table (`email` PK, `username`, bcrypt `password_hash`), signup/login at
  `POST /api/auth/signup` and `POST /api/auth/login`, plus `/login`, `/signup`, `/logout` pages
  and an auth modal in `app.html`.
- **Sessions**: `sessions` table (`token` → `email`), authenticated by an HTTP-only cookie or a
  `Bearer` token. `getSessionEmail(req)` resolves either; `careerEmail(req, res)` is the gate
  helper that returns the email or writes a `401 { error: 'login_required' }`.
- **Passwords**: bcrypt (`bcryptjs`), with legacy SHA-256 lazily re-hashed on login.

So the new endpoints simply **reuse `careerEmail`** — no new auth, sessions, or password code.
Because the whole app keys per-user rows by `email` (e.g. `saved_jobs`, `check_ins`), the queue
follows the same convention (email as the user key) rather than introducing a separate `user_id`.

## 2. Database schema & migration

The app uses **SQLite (`better-sqlite3`)** with raw SQL and a `CREATE TABLE IF NOT EXISTS` block
run at startup — there is **no migration framework**, so the table is created directly there
(same pattern as every other table). Added to `server.js`:

```sql
CREATE TABLE IF NOT EXISTS apply_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL,          -- the signed-in account (user key)
  job_url      TEXT,
  job_title    TEXT,
  company_name TEXT,
  job_board    TEXT,                   -- linkedin / indeed / greenhouse / lever / workday / …
  status       TEXT NOT NULL DEFAULT 'queued',
  resume_id    TEXT,
  cover_letter TEXT,
  form_data    TEXT,                   -- JSON snapshot of auto-filled fields
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(email, job_url)               -- dedupe a job per user
);
CREATE INDEX IF NOT EXISTS idx_apply_queue_email ON apply_queue(email);
```

`status ∈ { queued, auto_filled, submitted, manual_needed, archived }` (validated server-side).

## 3. API endpoints (all require an account → 401 otherwise)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/apply-queue` | add one job `{ job_url, job_title, company_name, job_board?, resume_id? }`; dedupes on `job_url` (returns `created:false`) |
| `POST` | `/api/apply-queue/batch` | add many `{ jobs: [...] }` in one transaction |
| `GET` | `/api/apply-queue?status=` | list the user's queue, optional status filter |
| `GET` | `/api/apply-queue/count` | `{ count, queued }` (drives the landing-page badge) |
| `PATCH` | `/api/apply-queue/:id` | update `status` / `formData` / `coverLetter` / `resumeId` |
| `DELETE` | `/api/apply-queue/:id` | remove one |

`job_board` is inferred from the URL host when the client doesn't pass one.

## 4. Files changed

- **`server.js`** — `apply_queue` table + the six endpoints (+ helpers `_applyEnqueue`,
  `_applyRowOut`, `_inferJobBoard`).
- **`public/career-hub.js`** — removed the `rt_aa_queue` localStorage logic; `autoApply` now
  `POST`s to the API, `renderApplyQueue` reads `GET /api/apply-queue`, `removeFromQueue` calls
  `DELETE`. Added a **sign-in prompt** on 401 and **12s polling** while the Job Finder is open
  (cross-device sync). The one-time `rt_aa_setup` acknowledgement stays local (UI only).
- **`public/tools/autoapply.html`** — shows the signed-in user's live queue count via
  `GET /api/apply-queue/count`.
- **`public/llms.txt`** — AutoApply / Job Finder entries now mention cross-device sync.
- **`autoapply/README.md`** — documents the hand-off: the main app's `/api/apply-queue` is the
  source of truth, with a clear TODO for wiring the standalone Next.js app + extension to it.
- **`test/apply-queue.js`** (new) — 25 route checks incl. cross-device sync + isolation.
- **`test/autoapply-integration.js`** — now asserts the server-side queue (no `localStorage`).

## 5. Cross-device sync

- The queue lives on the server; every device that signs into the same account reads the same
  rows immediately.
- While the Job Finder is open, the panel **polls `GET /api/apply-queue` every 12s**, so a job
  added on another device appears without a manual refresh (polling self-stops when the tool is
  left or the tab is hidden). SSE was not added — polling is trivial and sufficient here.

## 6. Test results

- **`test/apply-queue.js`** — 25/25 pass (auth gate, add/dedupe, batch, list+filter, patch,
  delete, count, board inference, **cross-device same-user visibility**, per-user isolation).
- **`test/autoapply-integration.js`** — pass (updated to server-side).
- **Full `test/*.js` suite** — green (`production-e2e` SKIPs on Node 22 by design).
- **Live E2E**: signed up a user (device A), logged in again (device B), added a job on A →
  it appeared on B, count synced, unauthenticated read returned 401.

## 7. Note on the standalone `autoapply/` app

The separate Next.js app + Chrome extension under `autoapply/` still use their own Prisma-backed
job list. The main app's `/api/apply-queue` is now the **source of truth**; a clear TODO in
`autoapply/README.md` describes wiring that app/extension to read and update it (server-to-server
with the user's session or a service token) so the two become one system.
