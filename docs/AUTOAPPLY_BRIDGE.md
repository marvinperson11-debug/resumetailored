# Bridging the standalone AutoApply app + extension to the main apply queue

Branch: `claude/auto-applyer-integration-at0p0d` · PR: [#422](https://github.com/marvinperson11-debug/resumetailored/pull/422)

Connects the standalone `autoapply/` Next.js app and its Chrome extension to the
main app's `/api/apply-queue` — the source of truth for the user's apply queue —
so the website Job Finder, the AutoApply dashboard, and the extension share one
queue.

## 1. What I found (standalone app)

- **Stack:** Next.js 14, Prisma + **PostgreSQL**, **NextAuth (Google OAuth)**.
- **Data model:** its own `User` / `JobApplication` (statuses `NEW`/`PREPARED`/
  `APPLIED`) / `ExtensionToken` / NextAuth `Account`+`Session`. The dashboard
  (`job-queue.tsx`) reads `GET /api/jobs`; Score/Prepare/Apply operate on local
  `JobApplication` ids; the extension reads `/api/jobs/:id/apply-data` with a
  bearer `ExtensionToken`.
- **Auth:** completely separate from the main app (NextAuth/Google vs. the main
  app's bcrypt sessions). **The one thing they share is the user's email.**

## 2. Auth mechanism used to bridge the two apps

A **shared service token + email**, because email is the only shared identity:

- The standalone app calls the main app with `x-rt-service-token: <secret>` and
  `x-rt-user-email: <the signed-in user's email>`.
- Main app `applyQueueEmail()` (server.js) honors this when `RT_SERVICE_TOKEN` is
  set and matches (constant-time compare) and the email is well-formed; otherwise
  it falls back to a normal browser session. The bridge is **off by default**
  (no token ⇒ session-only, unchanged behavior).
- The secret lives only on the standalone app's **server** (`RT_SERVICE_TOKEN`,
  `RT_MAIN_APP_URL`). The browser and the extension never see it — they call the
  standalone app's own proxy routes, which forward server-to-server.

No auth system was rebuilt on either side.

## 3. Replaced the DB, or added a sync layer?

**Added a sync layer (Option B)** — the local Prisma DB stays. Rationale: the
dashboard's Score/Prepare/Apply and the extension's `apply-data` flow are bound to
local `JobApplication` ids; replacing the data source outright (Option A) would
break them. Instead the app:

1. **reads** the main queue live (proxy `GET /api/apply-queue`),
2. **imports** it into local jobs (`POST /api/apply-queue/import`, idempotent,
   matches on `(userId, jobUrl)`, records `sourceQueueId`) so those flows run, and
3. **writes status back** to the main queue when a local job advances.

## 4. Files changed

**Main app**
- `server.js` — `applyQueueEmail()` service-or-session gate on the six
  `/api/apply-queue*` routes.
- `.env.example` — documents `RT_SERVICE_TOKEN`.
- `test/apply-queue.js` — service-bridge tests (read/add/patch as the companion,
  wrong-token 401, missing-email fallthrough, isolation).
- `test/autoapply-integration.js` — asserts the bridge exists.

**Standalone app (`autoapply/`)**
- `src/lib/queue-sync.js` — pure status maps + normalization (unit-tested).
- `src/lib/main-app-queue.ts` — server client; no-ops when unconfigured.
- `src/lib/api-identity.ts` — email from NextAuth session **or** ExtensionToken.
- `src/lib/queue-writeback.ts` — best-effort status write-back helper.
- `src/app/api/apply-queue/route.ts` (GET+POST), `[id]/route.ts` (PATCH),
  `count/route.ts` (GET), `import/route.ts` (POST) — proxy routes.
- `src/app/api/jobs/[id]/prepare/route.ts`, `.../apply-data/route.ts` — call the
  write-back on PREPARED / APPLIED.
- `src/components/job-queue.tsx` — "✓ Synced with your ResumeTailored queue"
  banner + count + Sync button + states.
- `prisma/schema.prisma` — new `JobApplication.sourceQueueId`.
- `.env.example` — `RT_MAIN_APP_URL` / `RT_SERVICE_TOKEN`.
- `test/queue-sync.test.mjs` — 25 pure-logic checks.
- `README.md` — replaces the TODO with the full mechanism + status table.

**Extension**
- `extension/src/lib/api.ts` — `fetchQueueCount` / `addToQueue` via the app proxy.
- `extension/src/popup/Popup.tsx` — shows the queue count.

## 5. Status mapping

| local (standalone) | → main (write-back) | main → local (read/import) |
| --- | --- | --- |
| `NEW` | `queued` | `queued`, `manual_needed` → `NEW` |
| `PREPARED` | `auto_filled` | `auto_filled` → `PREPARED` |
| `APPLIED` | `submitted` | `submitted`, `archived` → `APPLIED` |

Anything unmapped writes back as `manual_needed` (the spec's fallback).

## 6. Test results

- **Main `test/*.js` suite — green.** `test/apply-queue.js` (32 checks) proves the
  service round-trip end to end: the standalone app can read/add/patch a user's
  queue by email; a wrong token → 401; a valid token without an email header falls
  through to session auth; a service call is scoped to the named email only.
- **`autoapply/test/queue-sync.test.mjs` — 25/25 pass** (status maps both ways,
  normalization, headers, URL join, config guard).
- **`autoapply` `tsc --noEmit` — clean;** **extension `tsc --noEmit` — clean**
  (after `prisma generate` picked up `sourceQueueId`).

## 7. What a full live run needs (not possible in this sandbox)

Booting the standalone app end-to-end needs **PostgreSQL + Google OAuth
credentials**, which aren't available here, so the API round-trip test + full
typecheck stand in for the two-process demo. To run it for real:

1. Main app: set `RT_SERVICE_TOKEN` (and redeploy).
2. Standalone app: set `RT_MAIN_APP_URL` + the **same** `RT_SERVICE_TOKEN`, run
   `prisma db push` for the new column, `npm run dev`.
3. Sign in on the main app, add a job in the Job Finder → open the AutoApply
   dashboard → "Sync from ResumeTailored" → the job appears; Prepare/Apply it →
   `GET /api/apply-queue` on the main app shows `auto_filled` / `submitted`.
