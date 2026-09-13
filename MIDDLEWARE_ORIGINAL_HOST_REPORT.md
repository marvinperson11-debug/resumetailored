# middleware: honor `x-original-host` for subdomain routing

**PR #490** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `c23b0b1e`, commit `bccc262`, status SUCCESS).

Follow-up to #489 (career-site subdomains).

---

## The fix (one line)
The Cloudflare Worker (route `*.resumetailored.com/*`) forwards to `app.resumetailored.com` and sets **both** `x-original-host` and `x-forwarded-host` to the tenant subdomain — but Cloudflare's edge **overwrites `x-forwarded-host`** with `app.resumetailored.com`, so it's unreliable. `x-original-host` survives intact.

`middleware.ts` now resolves the tenant host in this order:

```ts
const sub = careerSubdomainFromHost(
  req.headers.get("x-original-host") || req.headers.get("x-forwarded-host") || req.headers.get("host")
);
```

(was `x-forwarded-host` → `host`). **Nothing else changed** — the reserved-subdomain list and the rest of the routing/rewrite logic are exactly as-is.

## Effect
- `marvin1245.resumetailored.com` (and any tenant subdomain) now resolves correctly through the Worker → internal rewrite to `/careers/{slug}`, URL bar unchanged.
- **apex / `app` / `www` unaffected**: on those, `x-original-host` is either absent (apex/app hit the origin directly) or a reserved label, so `careerSubdomainFromHost` returns `null` and routing proceeds normally.
- The Apply flow (`/jobs/:id`) and assets still route normally on the subdomain (only the root path is rewritten).

## Verification
- `tsc --noEmit` ✅ · `next lint --max-warnings=0` ✅ · `next build` ✅ (Middleware bundle compiles) · Railway deploy **SUCCESS**.
- Header-precedence check (logic): with `x-original-host: marvin1245.resumetailored.com` and `x-forwarded-host: app.resumetailored.com`, the resolver reads `x-original-host` first → subdomain = `marvin1245`. With no `x-original-host` and host = `app.resumetailored.com` → reserved → `null` (normal routing).

No app/DB changes; the Worker already sends both headers (deployed on your side).

## Unrelated, still open
- Pre-existing `test` (homepage-nav) failure on `main` — unrelated; fixable in its own small PR anytime.
- Optional from #489: old-slug 301 aliases if you want renamed subdomains to keep resolving.
- Phase 1B remaining: **Video Interviews** + **DocuSign**.
