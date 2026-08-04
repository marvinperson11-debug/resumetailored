# Career Hub — Scheduled Jobs: what I did & one decision

## Done
- ✅ **Merged PR #317** to `main` (Career Hub follow-ups + full Chinese localization).
- ✅ **Closed #316** (superseded).
- ✅ **Built the scheduler** for the two daily jobs → **PR #318** (ready, tests green).

## The one thing I changed from your instruction (and why)

You said: *"Build the Railway cron service config."* I built an **in-process scheduler inside the web service** instead — because a standalone Railway cron **service** genuinely cannot work here, and shipping config that silently does nothing would be worse than telling you.

**The reason, plainly:** both jobs need the app's database.
- `career:warm` **writes** the quiz/interview/scenario caches.
- `career:job-digest` **reads** `check_ins` to find opted-in users.

That database is **local SQLite on a Railway Volume**, and **a Railway Volume can only attach to one service**. A separate cron service = a separate container with its own empty filesystem → the digest emails nobody, the warmed cache is discarded. So the jobs must run **in the web service**, which owns the Volume. `career-cron.js` does exactly that (child processes on a daily UTC timer, same container, same DB).

This is the kind of architecture-changing decision you asked me to flag rather than plow through — hence this note.

## How it works (PR #318)
- `career-cron.js`, started from `server.js` in the main web process.
- **Off by default** — set `CAREER_CRON=on` to activate. Merging changes nothing until you flip it, so no surprise credit spend or emails.
- Times (UTC, configurable): `CAREER_WARM_HOUR_UTC=7`, `CAREER_DIGEST_HOUR_UTC=13`.
- Full setup in `docs/RAILWAY_CRON.md`, including `railway run npm run career:warm` for a manual one-off.

## To go live (after you merge #318)
1. Merge #318.
2. On the **web service** (the one with the Volume): set `CAREER_CRON=on`. Confirm `RAPIDAPI_KEY` + `RESEND_API_KEY` are on that service.
3. Redeploy → boot log shows `[career-cron] enabled — warm @ 07:00 UTC ..., digest @ 13:00 UTC ...`.

## Status of everything else
- **Career Hub is live on `main`** (deploys to Railway). You can test the app now — profession picker, Skills Lab, Interview Prep, Job Finder (real listings once `RAPIDAPI_KEY` is confirmed live), Gap Analyzer, Dashboard, Scenario Lab, and the 中文 toggle across UI + AI content.
- Chinese cache warming stays **off** (`WARM_LANGS=en`), per your call.

## Question for you
**Is the in-process scheduler acceptable, or do you specifically want the jobs in separate Railway services?** If the latter, the only way that works without moving off SQLite is a small **HTTP-trigger** variant: a minimal Railway cron service whose command pings a secured endpoint on the web service, which then runs the job with real DB access. Say the word and I'll build that instead — otherwise merge #318 and set `CAREER_CRON=on` and you're done.

*(A real fix for "truly separate services" is migrating the DB to Postgres — bigger project; happy to scope it if you're heading that way.)*
