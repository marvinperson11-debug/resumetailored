# Daily register-webhook 502 — diagnosis + fix

Branch `claude/daily-webhook-502-fix` → **draft PR [#503](https://github.com/marvinperson11-debug/resumetailored/pull/503)**. `tsc` / `lint` / `build` / route test all green; no new deps.

## TL;DR

Your three questions, answered from production:

1. **Is the ACTIVE deploy on the #501 fix?** — **Yes.** The fix is live. Not a deploy problem.
2. **What do the logs show?** — For these requests: **nothing** — no `[register-webhook]` line, no request log. That silence is itself the clue.
3. **Is it hanging / is Daily unreachable?** — **Not hanging.** The requests reach `api.daily.co` in ~1.2 s and get a **failure back**; the failure reason was being swallowed (unlogged), and your **Cloudflare layer was masking the 5xx** as an opaque "502 host error" so you never saw the JSON. Both are now fixed.

## What I checked (Railway)

- **Deploy state.** ACTIVE deployment `19dec1fb` (SUCCESS), commit `f5a096cc` = the #502 merge, which sits on top of #501's fix `f9c01280`. The old #500 deploy `69846ed4` (16:10 PDT, the one you saw) is `REMOVED`. **So the hardened route is deployed.**
- **HTTP metrics** for `/api/employer/daily/register-webhook` (last hour): 13 requests → **11× 5xx, 2× 4xx**.
- **Response times:** the 5xx took **~1187–1489 ms** (a real round trip to `api.daily.co`); the 4xx took **19–44 ms** (fast auth rejects — logged-out retries → 403). **Nothing is close to the 8 s timeout → nothing hangs.**
- **Logs:** since the deploy, the only lines are startup + one Supabase Node-version warning. **No `[register-webhook]` and no `[daily.*]` lines for the failing requests.**

## What the evidence proves

- `listWebhooks()` **succeeded** — it logs on any failure, and there is no such log. So the 5xx is not the read.
- The 5xx therefore comes from **`createWebhook()`**, whose non-ok branch returned a **502 with no `console.error`** → silent logs. (That is the whole reason "grep the logs" came up empty.)
- You see a **Cloudflare "502 host error" page**, not my JSON 502/503, because the **Cloudflare layer in front of the app rewrites any origin 5xx into its own branded 502**. So every correct JSON error the #501 hardening returned was masked before it reached you — which is exactly why it "looked like nothing changed."
- Side note: `export const maxDuration` (from #501) is a **Vercel serverless directive and a no-op under `next start` on Railway**, so it was never actually bounding anything. The real bound is the per-call `AbortSignal` timeout (8 s), which is working — that's why there's no hang.

## The fix (PR #503)

**`lib/daily.ts`** — stop swallowing the Daily error:
- `createWebhook()` and `listWebhooks()` now `console.error` the Daily **HTTP status + body**, and **classify the transport failure**: `AbortError` = our timeout, `ENOTFOUND`/`EAI_AGAIN` = DNS, `ECONNREFUSED`/`ETIMEDOUT`/`UND_ERR_*` = egress. `createWebhook` also puts `(HTTP nnn)` in the message it returns.

**`register-webhook/route.ts`** — stop Cloudflare masking the result:
- Expected operational outcomes — `registered` / `exists` / `created` / `not_configured` / `daily_unreachable` / `daily_error` / `internal` — now return **HTTP 200** with `{ ok, code, error }`, so the Cloudflare layer passes them through and you actually read them. **Only real auth rejection stays 403** (4xx already passes through — the metrics prove it).

**`test/daily-webhook-route.js`** — asserts no 5xx status remains, the new JSON outcomes, and the diagnostic logging.

## What happens after this deploys

Open (as signed-in admin, iPad is fine):

```
https://app.resumetailored.com/api/employer/daily/register-webhook?do=1
```

You will now get **HTTP 200 with a readable body** instead of the Cloudflare wall, one of:

- `{"ok":true,"status":"created", …}` — it worked.
- `{"ok":true,"status":"exists", …}` — already registered.
- `{"ok":false,"code":"daily_error","error":"Couldn't register the webhook: <Daily's reason> (HTTP nnn)"}` — **Daily rejected it; the reason is right there** (and in the logs as `[daily.createWebhook] non-ok <status> <body>`).
- `{"ok":false,"code":"daily_unreachable", …}` — timeout/DNS/egress; the server log names which.

**My read on the most likely root cause:** since egress works and the read succeeds but the *create* fails with a Daily error, the usual suspects are Daily **webhooks requiring a paid Daily plan** (Connect/webhooks are often not on the free tier), an **API key that isn't a full owner key**, or the **event-type name**. This deploy will show the exact Daily message. **Do one retry after it's live and I'll read the logs and report the root cause** (I'm watching PR #503 and will merge once CI is green, same as before).

## Files
- Changed: `resumetailored-platform/lib/daily.ts`, `resumetailored-platform/app/api/employer/daily/register-webhook/route.ts`
- Test: `test/daily-webhook-route.js`
