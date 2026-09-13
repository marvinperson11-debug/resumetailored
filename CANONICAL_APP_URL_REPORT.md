# Canonical public URLs — never build links from the raw Host header

**PR #493** (merged, `ff52ce4`) · **Deployed** to `app.resumetailored.com` (Railway deploy `91a2cee9`, **SUCCESS**).

## The bug

Behind Railway/Cloudflare the request `Host` header is the internal `localhost:8080`, so `new URL(req.url).origin` produced **unreachable** public links like `https://localhost:8080/site/marvin`. The personal-site publish **"Live!"** link was the reported symptom.

## The fix

New pure helper **`appUrl(path)`** in `lib/subdomain.ts`:

```ts
export function appUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || APP_ORIGIN).replace(/\/+$/, "");
  if (!path) return base;
  return base + (path.startsWith("/") ? path : "/" + path);
}
```

`APP_ORIGIN` is already `https://app.resumetailored.com`, so the default equals the desired canonical origin even when the env var is unset. **Every** place that built an outbound/shareable absolute URL from the request now routes through it:

| Route | Public link | Was |
|---|---|---|
| `POST /api/personal-website/publish` | `/site/{slug}` — the **"Live!"** link | `new URL(req.url).origin` |
| `GET /api/personal-website/mine` | `/site/{slug}` | `new URL(req.url).origin` |
| `GET/PUT /api/shareable` | `/u/{username}` | `new URL(req.url).origin` |
| `POST /api/employer/team` | `/join?token=…` (emailed invite) | `new URL(req.url).origin` |
| `PATCH /api/employer/team/[id]` (resend) | `/join?token=…` | `new URL(req.url).origin` |

(The `mine` handler no longer takes `req` at all — its only use of it was the origin.)

## "Live!" link display

The Publish panel (`studio-panels.tsx`) already shows **`{slug}.resumetailored.com`** as the primary address with `app.resumetailored.com/site/{slug}` as the smaller alternate. The copyable/openable "Live!" URL (`publishedUrl`) is the route's returned `url`, which is now canonical — so it opens the real public site instead of `localhost:8080`.

## Sweep

Grepped the whole `resumetailored-platform/` for `headers.get("host")`, `req.headers.host`, `x-forwarded-host`, `new URL(req.url).origin`, `req.nextUrl.origin`. Findings:

- **5 URL-construction sites** — all fixed (table above).
- **`middleware.ts`** reads `x-original-host` / `x-forwarded-host` / `host` — but only to **resolve the incoming tenant subdomain**, not to build a link. Correctly left unchanged.
- No other absolute-URL-from-header construction exists. (Career-site builder already computes its URL client-side from `careerSubdomainUrl(slug)` + `window.location.origin`, so it was never affected. Employer notify emails don't embed a site URL.)

## Env

Set **`NEXT_PUBLIC_APP_URL = https://app.resumetailored.com`** on the Railway `web` service (was missing). Behavior was already correct via the code default; this makes the origin explicit and overridable.

## Cleanup

Removed the temporary **`app/api/whoami`** debug route (subdomain proxy headers verified in the previous phase).

## Verification

- `tsc --noEmit` ✅ · `next lint --max-warnings=0` ✅ · `next build` ✅
- Railway deploy `91a2cee9` → **SUCCESS**.
- Live: `GET /api/whoami` → **404** (route gone, new build serving); `GET /api/tenant-resolve?label=zzz-nope-12345` → `{"type":null}` 200 (app healthy).
- The `/site/{slug}` "Live!" URL is now built from the canonical origin, so a publish returns `https://app.resumetailored.com/site/{slug}` regardless of the internal Host.

## Note

CI's `test` job is red for a **pre-existing, unrelated** reason: two homepage-nav ordering assertions in the legacy Express app (`test/homepage-ui-bugs.js`, `中文`/Login/CTA order in `public/index.html`). It was already failing on `main` and this change touches only `resumetailored-platform/`. Say the word if you want that homepage-nav test fixed.
