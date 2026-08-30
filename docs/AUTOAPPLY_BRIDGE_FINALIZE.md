# AutoApply bridge — finalization (env checks, migration, smoke test, status pill)

Branch: `claude/auto-applyer-integration-at0p0d` · PR: [#422](https://github.com/marvinperson11-debug/resumetailored/pull/422)

Deployment-safety follow-ups on top of the bridge.

## 1. Env / startup checks added

**Main app (`server.js`)** — at boot, alongside the other startup warnings:

- Missing → `console.warn("[AutoApply Bridge] RT_SERVICE_TOKEN not set — standalone app cannot sync (session-only mode)")`
- Present → `console.log("[AutoApply Bridge] RT_SERVICE_TOKEN set — the standalone AutoApply app can sync the apply queue.")`

Both verified by booting the app with and without the var.

**Standalone app (`autoapply/`)** — `src/instrumentation.ts` (`register()`, enabled
via `experimental.instrumentationHook` in `next.config.mjs`) runs **once on server
boot** and logs:

- Configured → `[AutoApply Bridge] configured → <RT_MAIN_APP_URL> (apply-queue sync enabled).`
- Missing → a warning naming exactly which of `RT_MAIN_APP_URL` / `RT_SERVICE_TOKEN`
  is unset, and that the app **degrades gracefully** (local job list, "Bridge not
  configured" pill) rather than crashing.

`src/lib/bridge-config.ts` centralizes the `{ configured, mainAppUrl, missing[] }`
check used by the instrumentation and the UI's health signal. `.env.example` in
both apps documents the vars (done in the prior commit).

## 2. Prisma migration — created (was `db push` only)

The project had **no migrations dir** (it used `prisma db push`). I adopted Prisma
Migrate, generated **offline** with `prisma migrate diff` (no live DB needed):

- `prisma/migrations/0_init/migration.sql` — full baseline schema.
- `prisma/migrations/20260830140000_add_source_queue_id/migration.sql` —
  `ALTER TABLE "JobApplication" ADD COLUMN IF NOT EXISTS "sourceQueueId" TEXT;`
  (`IF NOT EXISTS` makes it idempotent on both a fresh DB and an existing one).
- `prisma/migrations/migration_lock.toml` (`postgresql`).
- New script **`npm run db:migrate`** = `prisma migrate deploy`.

**Is `db push` or migrate the intended path?** Both are supported and documented:

- Fresh DB / CI: `npm run db:migrate` (versioned, safe).
- Existing `db push` DB adopting migrations: `npx prisma migrate resolve --applied
  0_init` once, then `npm run db:migrate`.
- Quick local dev, or the minimal upgrade: `npm run db:push` (adds the nullable
  column non-destructively).

## 3. Smoke-test script

**Location:** `scripts/smoke-test-autoapply-bridge.js` (repo root).

**Run:**
```bash
node scripts/smoke-test-autoapply-bridge.js \
  --main-url http://localhost:3000 --service-token "$RT_SERVICE_TOKEN"
```
Add `--standalone-url <url> --extension-token aa_xxx` to also exercise the real
standalone proxy (`/count`, `/import`). Flags: `--main-url`, `--service-token`
(or env `RT_SERVICE_TOKEN`), `--standalone-url`, `--extension-token`, `--email`,
`--keep`. It **points at running instances** (doesn't boot them — the standalone
app needs Postgres + Google OAuth).

**What it checks (PASS/FAIL per step):** main reachable → create test user → add a
job as the user → **read it back as the standalone service** (`fetchMainQueue`) →
import (skipped unless standalone URL + extension token) → **status write-back**
`auto_filled` then `submitted` (`updateMainStatus`) → cleanup. Prints a summary
and exits non-zero on any failure.

**Local run result (main app on SQLite, service token set):**
```
PASS 1. main app is reachable
PASS 2. create a test user on the main app (signup)
PASS 3. add a job to the main queue as the user
PASS 4. standalone app reads the job from the main queue (service bridge)
SKIP 5. import into the standalone app's local DB (needs --standalone-url + --extension-token)
PASS 6a. write-back PREPARED → auto_filled reflects on the main queue
PASS 6b. write-back APPLIED → submitted reflects on the main queue
PASS 7. cleanup: delete the test job
SUMMARY: 7 passed, 0 failed, 1 skipped
```

## 4. UI status pill

`job-queue.tsx` header shows one pill, derived from the `/api/apply-queue/count`
response + the local imported-job count:

- **● Synced** (green) — bridge reachable and the local list is up to date.
- **● Sync pending** (amber) — a sync is running, or the main queue has jobs not
  yet imported (`queueCount > jobs with sourceQueueId`).
- **● Bridge offline** (red) — the count call returned 502 (main app unreachable).
- **● Bridge not configured** (grey) — the bridge env isn't set on this server
  (the Sync button is hidden). This is the graceful-degrade state.

`/api/jobs` now returns `sourceQueueId` so the UI can tell imported jobs apart.

## 5. Deployment checklist (added to `autoapply/README.md`)

- [ ] `RT_SERVICE_TOKEN` set on the main app
- [ ] `RT_SERVICE_TOKEN` + `RT_MAIN_APP_URL` set on the standalone app
- [ ] the two token values match exactly
- [ ] `npm run db:migrate` (or `db:push`) run in the standalone app
- [ ] smoke test passes
- [ ] dashboard shows the green **● Synced** pill

## 6. Test results

- **Main `test/*.js` — green** (0 failures; `production-e2e` SKIPs on Node 22).
- **`autoapply/test/queue-sync.test.mjs` — 25/25 pass.**
- **`autoapply` `tsc --noEmit` — clean;** **extension `tsc --noEmit` — clean.**
- **Smoke test — 7 PASS / 0 FAIL / 1 SKIP** against a live main app.

Not runnable in this sandbox: a full two-process live run (dashboard needs
Postgres + Google OAuth). The smoke test's service-bridge steps + the full
typechecks stand in for it; the `import` and real-proxy steps run once you point
the script at a deployed standalone app with an extension token.
