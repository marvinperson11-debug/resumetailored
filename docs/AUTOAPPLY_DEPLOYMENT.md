# AutoApply — deployment status & do-this-next

## ✅ / 🟡 / 🔴 at a glance

| Step | Status |
|---|---|
| 1. Merge PR #422 | ✅ **Done** — squash-merged to `main` (`3b6873f`) |
| — Production deploy of the merge | ✅ **Done** — Railway deploy `2dc0e5c6` = SUCCESS; bridge code is live |
| 2. Generate `RT_SERVICE_TOKEN` | ✅ **Done** — value below |
| 3. `npm run db:migrate` (standalone) | 🔴 **You** — needs the standalone app's Postgres `DATABASE_URL`, which I don't have (and there's no Postgres in my sandbox). Command below. |
| 4. Production smoke test | 🟡 **Blocked on step 5-Railway** — can't pass until the token is set on Railway. Pre-flight passed; I'll run the full test the moment you've set it. |
| 5. Set env vars (Railway + Vercel) | 🟡 **You** — I was blocked from writing production env vars (safety policy). Paste list below. |

## 🔑 Your `RT_SERVICE_TOKEN` (exact value — treat as a secret)

```
86c54f996ffe86964163dedc1aad663236c7eb29840272c9f4e0126aa73288e0
```

The **same** value goes on both apps. Generated with `crypto.randomBytes(32)` (256-bit).

## 📋 Paste THIS into THAT

### Railway — main app (`resumetailored` service, production)
Add **one** variable:

```
RT_SERVICE_TOKEN = 86c54f996ffe86964163dedc1aad663236c7eb29840272c9f4e0126aa73288e0
```

Railway redeploys automatically. After it's live, the startup log shows
`[AutoApply Bridge] RT_SERVICE_TOKEN set — the standalone AutoApply app can sync…`

> I tried to set this for you via the Railway API but the action was blocked by a
> safety policy on production infrastructure changes, so it's yours to paste.

### Vercel (or wherever the standalone `autoapply/` app is hosted)
Add **two** variables:

```
RT_SERVICE_TOKEN = 86c54f996ffe86964163dedc1aad663236c7eb29840272c9f4e0126aa73288e0
RT_MAIN_APP_URL  = https://resumetailored.com
```

(The standalone app also needs its usual `DATABASE_URL`, `NEXTAUTH_SECRET`,
`NEXTAUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `OPENAI_API_KEY` — those are unchanged.)

## 🔴 Step 3 — run the migration (I can't; needs your Postgres)

In the `autoapply/` directory, against the standalone app's production database:

```bash
cd autoapply
npm ci
npm run db:migrate        # = prisma migrate deploy
```

- **Fresh DB:** that's all — it applies `0_init` + `…_add_source_queue_id`.
- **Existing db-push DB** (no migration history yet): baseline once, then deploy:
  ```bash
  npx prisma migrate resolve --applied 0_init
  npm run db:migrate
  ```
- **Or** the one-liner minimal upgrade: `npm run db:push` (adds the nullable
  `sourceQueueId` column non-destructively).

I can't run this here because it needs the standalone app's real `DATABASE_URL`
(a hosted Postgres), which isn't in my environment.

## 🟡 Step 4 — the production smoke test

The full service-bridge smoke test **needs the token live on Railway first**
(without it, the server correctly rejects the service call — I verified prod
returns 401 right now, which proves the bridge is inactive until you set the token).

Once you've pasted `RT_SERVICE_TOKEN` on Railway and it has redeployed, run
(leaves **zero** persistent data thanks to `--no-signup`):

```bash
node scripts/smoke-test-autoapply-bridge.js \
  --main-url https://resumetailored.com \
  --service-token 86c54f996ffe86964163dedc1aad663236c7eb29840272c9f4e0126aa73288e0 \
  --no-signup
```

**Or just reply "token is set"** and I'll run it for me — running the script
against prod isn't blocked; only writing the env var was.

### Production pre-flight I already ran (all green)

| Check | Result |
|---|---|
| `GET /api/status` | ✅ 200 |
| `GET /api/apply-queue/count` (unauth) | ✅ 401 (route deployed) |
| `GET /job-finder` | ✅ 200 |
| `GET /tools/autoapply` | ✅ 200 |
| Service call before token set | ✅ 401 (bridge correctly inactive until token set) |

## Final deploy checklist

- [x] PR #422 merged to `main`
- [x] Main app deployed with the bridge code (Railway `3b6873f` SUCCESS)
- [x] `RT_SERVICE_TOKEN` generated
- [ ] `RT_SERVICE_TOKEN` set on Railway (main app) ← **you**
- [ ] `RT_SERVICE_TOKEN` + `RT_MAIN_APP_URL` set on the standalone app ← **you**
- [ ] `npm run db:migrate` run in `autoapply/` ← **you**
- [ ] Production smoke test passes ← me, once the token is set
- [ ] AutoApply dashboard shows the green ● Synced pill ← after the standalone app is deployed
