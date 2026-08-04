# Career Hub — Env Confirmation & Status

## 1. RESEND_API_KEY (job digest emails) — ✅ same variable, will work

The digest script reads the **exact same** variable the existing password-reset flow uses:

| Where | Reads |
|---|---|
| `server.js` `sendEmail()` (password reset, leads, publish emails) | `process.env.RESEND_API_KEY` |
| `scripts/job-digest.js` | `process.env.RESEND_API_KEY` |

So **wherever password-reset emails already work, the digest works** — no new variable, no rename. One operational caveat: the digest runs as a **separate process** (a cron job), so it must run **inside the same Railway service** (via a Railway scheduled job or `railway run npm run career:job-digest`). Railway injects the service's variables into those processes, so `RESEND_API_KEY` is inherited automatically. It also honors `EMAIL_FROM` if you've set it (same as `sendEmail`).

> I could not read the Railway dashboard from here to eyeball it (that check needs an interactive approval this session can't grant). This is a code-level confirmation: the name matches and the propagation model is standard. If you want a dashboard-level confirmation, it's under Railway → your service → Variables → look for `RESEND_API_KEY`.

## 2. RAPIDAPI_KEY (JSearch) — set this one variable

- **Variable name (exact):** `RAPIDAPI_KEY`
- **Value:** the raw RapidAPI application key string — the `X-RapidAPI-Key` value from your RapidAPI dashboard. No prefix, no quotes, no `Bearer`.
- **Also make sure:** your RapidAPI account is **subscribed to the JSearch API** (`jsearch.p.rapidapi.com`) with that key (even the free tier), or JSearch returns 403.

Both consumers already read it identically:

| Where | Reads | Sends |
|---|---|---|
| `server.js` `jsearchFetch()` (live `/api/jobs/search`) | `process.env.RAPIDAPI_KEY` | header `X-RapidAPI-Key`, host `jsearch.p.rapidapi.com` |
| `scripts/job-digest.js` | `process.env.RAPIDAPI_KEY` | same |

So: add `RAPIDAPI_KEY=<your key>` in Railway → Variables. Nothing else to wire — you don't need to send me the key. When it's set, `/api/jobs/search` starts returning real listings (it returns a friendly `jobs_unconfigured` until then), and the digest can send.

Already documented in `.env.example`.

## Chinese cache warming — OFF (as requested)

`scripts/warm-career-cache.js` defaults to `WARM_LANGS=en` (English only). Chinese content is still generated on demand (first Chinese user of a role waits ~1–2s once, then it's cached cross-user). Flip to `WARM_LANGS=en,zh` when Chinese traffic justifies the ~2× nightly credits.

## Scheduling the two cron jobs (still needs a decision)

The scripts are one-shot runners; they need a scheduler:
- Nightly: `npm run career:warm` (needs `ANTHROPIC_API_KEY`)
- Daily AM: `npm run career:job-digest` (needs `RAPIDAPI_KEY` + `RESEND_API_KEY`)

Two options — **tell me which and I'll build it:**
1. **Railway cron service** — a small config / service that runs the npm script on a schedule. Cleanest if you're all-in on Railway.
2. **Guarded HTTP trigger endpoints** (e.g. `POST /api/cron/job-digest` behind a secret header) that any external scheduler (cron-job.org, GitHub Actions) can hit. More portable.

Until one is set up, the opt-in toggle and the scripts all work when run manually — nothing is broken, digests just won't send on their own yet.

## Open PRs

- **#317** — full Chinese localization **+ the follow-ups work** (badge noindex, answer-score cap, job alerts, GA). Supersedes **#316**. Draft, tests green.
- To test the Career Hub **live**, #317 needs to be on `main` (Railway deploys from main; the Netlify preview only serves static pages, not the Node backend). Say the word and I'll mark #317 ready, merge it, and close #316.

## Going forward
Understood — building with confidence, pushing phases as they're ready, and flagging only genuine blockers (missing env, unexpected API behavior, architecture-changing decisions). 

## Questions for you
1. **Merge #317 to main now** so you can test the Career Hub live on Railway? (I'll close #316 with it.)
2. **Which scheduler** for the two cron jobs — Railway cron service, or guarded HTTP trigger endpoints?
