# Career Hub — Live Deploy & Test Guide

## Status: shipped ✅
- **#318 merged to `main`** → the in-process scheduler deploys with the app.
- **`CAREER_CRON=on`** is set in Railway → the scheduler activates on this deploy.
- Everything from earlier is already on `main`: the full Career Hub (6 tools + Scenario Lab), the follow-ups (badge noindex, answer-score 5/day cap, job alerts, GA), and full Chinese localization.

## Confirm the scheduler came up
In the Railway **web service** deploy logs, look for this line on boot:
```
[career-cron] enabled — warm @ 07:00 UTC (npm run career:warm), digest @ 13:00 UTC (npm run career:job-digest)
```
If instead you see `[career-cron] disabled`, `CAREER_CRON` didn't reach that service — check it's set on the **web** service (the one with the Volume), then redeploy.

- **Warm** runs nightly at 07:00 UTC (adjust with `CAREER_WARM_HOUR_UTC`).
- **Digest** runs daily at 13:00 UTC (adjust with `CAREER_DIGEST_HOUR_UTC`).

## What to test in the app (all under the "Career Hub" sidebar group)
1. **Profession picker** — first open prompts it; pick a role → every tool tailors to it.
2. **Skills Lab** — take a quiz, submit, earn a badge, open the public `/badge/:slug` page, hit Retake.
3. **Interview Prep** — Behavioral (free) + Technical (Pro); Reveal; confidence chips; "Score my answer" (Pro).
4. **Skills Gap** — pick a saved resume or paste one + a job description → match score, gaps, quick wins, study plan.
5. **Job Finder** — real listings now that `RAPIDAPI_KEY` is live; filters; Save; the "Analyze" cross-sell; the daily-digest opt-in toggle.
6. **Scenario Lab** — pick a type, work the branching steps, wrong choices show consequences + retry.
7. **Dashboard** — stats, badges, top gaps, next steps; AI coach summary (Pro).
8. **中文 toggle** — flip language: the entire Career Hub (UI **and** AI-generated quiz/interview/scenario/gap content) switches to Chinese. First Chinese generation of a role waits ~1–2s, then it's cached.

## Verify the digest without waiting for 13:00 UTC
1. In the app, open **Job Finder** and turn on the **daily digest** toggle (this sets `check_ins.job_alerts=1` + your language).
2. Then run it once manually from your machine (Railway CLI):
   ```
   railway run npm run career:job-digest
   ```
   It runs in the service context (same env + Volume), searches JSearch for your profession, and emails you the top 5. Subject: `N new <Profession> jobs posted today` (localized if you're in Chinese mode).
   - If `RESEND_API_KEY` isn't reachable it logs `[dry-run] would email …` instead of sending — a safe way to confirm the pipeline before real sends.

## Cost reminders
- Chinese cache warming stays **off** (`WARM_LANGS=en`) — flip to `en,zh` only when Chinese traffic justifies ~2× nightly credits.
- The nightly warm covers the **top 20** roles only; everything else generates lazily on first use.

## Questions / optional next steps
1. **Want a report back on the boot log line?** If the scheduler shows `disabled`, paste me the line and I'll help chase the env down.
2. **Optional:** a tiny **admin trigger endpoint** (`POST /api/admin/cron/:job` behind `ADMIN_SECRET`) so you can fire warm/digest from a browser/curl without the Railway CLI. Say the word and I'll add it.
3. Otherwise: I'm standing by for your live-test findings — send bugs/adjustments and I'll turn them around.
