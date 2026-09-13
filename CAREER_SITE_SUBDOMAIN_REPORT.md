# Career-site subdomains — {slug}.resumetailored.com

**PR #489** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `37ff1f85`, commit `60bc254`, status SUCCESS).

An employer's career site is now reachable at **`{slug}.resumetailored.com`** (the primary address shown in the builder) as well as the existing **`/careers/{slug}`** path. The `career_sites.slug` remains the single source of truth — **no new column, no subdomain cache**.

---

## ⚠️ Infra (your side)
- **Wildcard DNS** `*.resumetailored.com → Railway` — you're handling in Cloudflare. Subdomains only work once this propagates.
- **TLS** — Cloudflare's universal cert covers one-level `*.resumetailored.com`; no app cert work.
- **Proxy headers** — the app trusts the forwarded Host: middleware reads `x-forwarded-host` then `host`. Cloudflare→Railway passes the original `Host` through, so `walmart.resumetailored.com` arrives intact. Nothing else to configure. (If you ever front it with a proxy that rewrites Host, keep `x-forwarded-host` set.)

## What shipped (app)
- **`lib/subdomain.ts`** (edge-safe, no deps): `RESERVED_SUBDOMAINS` (`www, app, api, mail, admin, dashboard, careers, jobs, employer, support, help, billing, status, docs, blog`) and `careerSubdomainFromHost()` — maps a **single-level, non-reserved** `*.resumetailored.com` host to a slug. The apex, `www`/`app`, reserved labels, deeper labels, and **all non-production hosts** (Railway/Netlify/localhost/custom) route normally. Plus `isValidSlug` / `normalizeSlug` / `careerSubdomainUrl`.
- **`middleware.ts`**: on a career subdomain it **rewrites** (not redirects) the **root path** to `/careers/{slug}`, so the URL bar keeps the subdomain. Only `/` is rewritten — the **Apply flow (`/jobs/:id`)** and assets still route normally on the subdomain. No DB work in middleware (pure host parse + rewrite); the `/careers/[slug]` page does the single lookup it already did.
- **Unknown subdomain / slug** → the page's `notFound()` renders a friendly **`app/careers/[slug]/not-found.tsx`** (404 status) that never reveals whether another slug exists.
- **Editable slug**: `PATCH /api/employer/career-site` validates format + reserved words + **uniqueness (409 if taken)**; new **`GET /api/employer/career-site/slug-available`** for live checks. Store gains `isSlugAvailable` and `slug` in `CareerSiteInput`/`toRow`.
- **Builder**: a **"Career site address"** field (`your-company` + `.resumetailored.com`) with live availability and a domain-change warning ("previously shared links will stop working"). The URL bar shows **`{slug}.resumetailored.com`** as primary, with `/careers/{slug}` as the smaller alternate.
- **Public page**: `canonical` + `og:url` now point at the subdomain.

## Constraints honored
- No new dependencies; middleware is a fast host-parse + rewrite (no per-request DB hit). Existing apex/`www`/`app` routing untouched. `tsc` ✅ · `next lint` ✅ · `next build` ✅ (middleware + slug-available route compile) · Railway deploy **SUCCESS**.

## Verify (after DNS propagates)
1. Pick a real slug in the builder (e.g. set the address to `walmart`), Save.
2. Visit `walmart.resumetailored.com` → renders that employer's careers page, **URL bar unchanged**; **Apply** on a job → `/jobs/:id` works on the subdomain.
3. An **unknown** subdomain (e.g. `nope-nope.resumetailored.com`) → clean **404** "Careers page not found".
4. `app.resumetailored.com` and `resumetailored.com` behave exactly as before.
5. In the builder, editing the address live-checks availability and warns before you change your primary domain.

## Notes / possible follow-ups
- **Old address after a slug change** doesn't redirect — the previous subdomain and `/careers/old` simply 404. If you want shared-link continuity, I can add a `career_site_aliases` table (old-slug → current-slug) and a 301, mirroring the personal-site `site_aliases` pattern in the legacy app. Say the word.
- Middleware rewrites only the root path on a subdomain; the career site is a single page so there are no sub-routes to worry about, and this deliberately preserves `/jobs/:id`.

## Unrelated, still open
- Pre-existing `test` (homepage-nav) failure on `main` — unrelated; fixable in its own small PR anytime.
- Phase 1B remaining: **Video Interviews** + **DocuSign**.
