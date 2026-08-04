# Career Hub scheduled jobs (Railway)

Two daily jobs power the Career Hub:

| Job | Command | Needs | Default time |
|---|---|---|---|
| Warm content caches (top 20 roles) | `npm run career:warm` | `ANTHROPIC_API_KEY` | 07:00 UTC |
| Job-alert digest email | `npm run career:job-digest` | `RAPIDAPI_KEY` + `RESEND_API_KEY` | 13:00 UTC |

## How it runs: in-process, inside the web service

Both jobs are scheduled **inside the web service** by `career-cron.js` (started
from `server.js` when the app boots as the main process). It runs each job on a
daily UTC timer as a child process, so they share the web container's filesystem
and therefore its **SQLite database** (`DATA_DIR`, a Railway Volume in prod).

### Why not a standalone Railway "cron service"?

Because both jobs need the app's database, and it's **local SQLite on a Volume**:

- `career:warm` **writes** the quiz/interview/scenario caches.
- `career:job-digest` **reads** `check_ins` for opted-in users.

A Railway Volume attaches to **exactly one service**, and a separate cron
service is a separate container with its own empty filesystem. It could not see
the real DB — the digest would email nobody and the warmed cache would be
discarded. So a standalone cron service is not viable **with the current SQLite
setup**. (It becomes viable only if the app moves to a networked DB like
Postgres — see "Future" below.)

## Activate it

1. In the **web service's** Variables (the one with the Volume), set:
   ```
   CAREER_CRON=on
   ```
   Optionally adjust the UTC hours:
   ```
   CAREER_WARM_HOUR_UTC=7
   CAREER_DIGEST_HOUR_UTC=13
   ```
2. Make sure the required keys are set on that same service: `ANTHROPIC_API_KEY`
   (already present), plus `RAPIDAPI_KEY` and `RESEND_API_KEY` for the digest.
3. Redeploy. On boot the log prints:
   ```
   [career-cron] enabled — warm @ 07:00 UTC ..., digest @ 13:00 UTC ...
   ```

Leave `CAREER_CRON` unset/`off` to keep both jobs dormant (they can still be run
by hand with the npm commands). Nothing auto-spends credits or sends email until
you flip it on.

## Run once, by hand (any time)

```
railway run npm run career:warm
railway run npm run career:job-digest
```
`railway run` executes in the service's context, so it inherits the same env and
Volume — this is the manual equivalent of a tick.

## Future: standalone cron services (only with a networked DB)

If the app is migrated to Postgres (or any DB reachable over the network), each
job can become its own Railway service that runs the command on a **Cron
Schedule** and connects to the shared DB. At that point set `CAREER_CRON=off` on
the web service and create two services, each pointing at this repo with:

- Custom Start Command: `npm run career:warm` / `npm run career:job-digest`
- Cron Schedule: `0 7 * * *` / `0 13 * * *`

Until then, the in-process scheduler above is the correct approach.
