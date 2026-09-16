# Daily Webhook Setup — answer + admin route

You're right that the current Daily dashboard has no Webhooks section. Here's both the "where" and the automated route I built.

## Where webhooks live in the current Daily UI
**They don't have a general dashboard page.** Daily manages webhook endpoints through its **REST API** (`/v1/webhooks`) — creating, listing, and deleting endpoints is an API operation, not a Settings toggle. The dashboard's Developers page is only API keys / HIPAA / logs, and Settings has no webhook UI. (Daily does surface *per-webhook* status once one exists, but there's no "add endpoint" button in the standard console.) So registering it via the API with our key is the correct, supported path — not a workaround.

## What I added — an idempotent admin route
Branch `claude/daily-webhook-register` → **draft PR [#500](https://github.com/marvinperson11-debug/resumetailored/pull/500)**. No new deps; `tsc`/`lint`/`build` green.

- **`POST /api/employer/daily/register-webhook`** — registers `https://app.resumetailored.com/api/daily/webhook` for the `recording.ready-to-download` event. **Idempotent:** it lists the account's existing webhooks first and only creates ours if missing (`status: "exists"` otherwise).
- **`GET /api/employer/daily/register-webhook`** — read-only status check (is it registered? how many webhooks exist?), changes nothing.
- Admin-only (`access.isAdmin`); `503` if `DAILY_API_KEY` is unset.
- `lib/daily.ts` gained `listWebhooks()` + `createWebhook()`.

## How to run it (once, after deploy)
Both endpoints need your signed-in **admin** session cookie (they're gated to the admin account), so the simplest path is from a browser logged in as the admin:

1. Set **`DAILY_API_KEY`** in Railway (and, if you want signature verification from the first delivery, **`DAILY_WEBHOOK_SECRET`** too), then deploy.
2. Optional dry run — open in the admin browser:
   `https://app.resumetailored.com/api/employer/daily/register-webhook` (GET) → shows `{ url, registered, count }`.
3. Register — POST the same URL. Easiest from the browser console while logged in:
   ```js
   fetch('/api/employer/daily/register-webhook', { method: 'POST' }).then(r => r.json()).then(console.log)
   ```
   or with curl if you copy your session cookie:
   ```
   curl -X POST https://app.resumetailored.com/api/employer/daily/register-webhook -H "Cookie: <admin session cookie>"
   ```
4. Response:
   - `{ status: "created", url, uuid, hmacSecret? , note }` on first run.
   - `{ status: "exists", url, uuid }` on any subsequent run.

## Signature verification (recommended)
- **If `DAILY_WEBHOOK_SECRET` was set before you POST:** the webhook is registered *signed with it* — verification is active immediately, nothing else to do.
- **If it wasn't set:** the response includes `hmacSecret` (the secret Daily generated). Put that value in `DAILY_WEBHOOK_SECRET` in Railway and redeploy. Until then, `/api/daily/webhook` still works — it accepts unsigned deliveries and validates the payload shape.

## Notes
- Optional `DAILY_WEBHOOK_URL` env var overrides the registered endpoint URL (defaults to `<app origin>/api/daily/webhook`) — rarely needed.
- To re-point or remove the endpoint later, you'd delete it via the API (`DELETE /v1/webhooks/{uuid}`); say the word and I'll add an unregister route too.

## Open question
- Want me to mark #500 ready and merge once CI is green (same as #495–#499)?
