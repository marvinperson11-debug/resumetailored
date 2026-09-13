# DEBUG: `/api/whoami` proxy-header inspection route

**PR #491** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `429aa1bd`, commit `1c80ca7`, status SUCCESS).

Temporary instrumentation to diagnose subdomain routing through the Cloudflare Worker.

---

## What it is
`GET /api/whoami` — no auth, no caching (`Cache-Control: no-store`, `dynamic = "force-dynamic"`). Returns exactly what the server received:

```json
{ "host": "…", "xForwardedHost": "…", "xOriginalHost": "…", "pathname": "/api/whoami" }
```

File: `app/api/whoami/route.ts`.

## Baseline (direct app host — confirmed working)
```
$ curl https://app.resumetailored.com/api/whoami   → 200
{"host":"app.resumetailored.com","xForwardedHost":"app.resumetailored.com","xOriginalHost":null,"pathname":"/api/whoami"}
```
As expected off the app host: no Worker in that path, so `x-original-host` is `null`.

## The test that matters (through the Worker / a tenant subdomain)
Once `*.resumetailored.com` DNS + the Worker route are live, hit it via a tenant subdomain and read the JSON:

```
curl -s https://marvin1245.resumetailored.com/api/whoami
```

Interpretation:
- **`xOriginalHost` = `marvin1245.resumetailored.com`** → the Worker is forwarding the header correctly and the middleware fix (#490, which now prefers `x-original-host`) will resolve the tenant. ✅
- **`xOriginalHost` = `null`** but `host`/`xForwardedHost` show the subdomain → the Worker isn't sending `x-original-host` on this path (or it's being stripped); we'd fall back to those.
- **All three = `app.resumetailored.com`** → the tenant host isn't reaching the origin at all (Worker/route not matching, or DNS not resolving yet).

`/api/whoami` is not rewritten by middleware (only the root path is), so it reflects the raw headers as received.

## Verification
`tsc --noEmit` ✅ · `next lint --max-warnings=0` ✅ · `next build` ✅ · Railway deploy **SUCCESS** · live 200 on the app host.

## ⚠️ Temporary — remove next
This route is instrumentation only. Once subdomain routing is confirmed working, I'll delete `app/api/whoami/route.ts` in a follow-up PR (just say "remove whoami").

## Unrelated, still open
- Pre-existing `test` (homepage-nav) failure on `main` — unrelated.
- Optional from #489: old-slug 301 aliases.
- Phase 1B remaining: **Video Interviews** + **DocuSign**.
