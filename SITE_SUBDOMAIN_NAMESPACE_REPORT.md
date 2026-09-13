# Candidate personal-site subdomains + shared slug namespace

**PR #492** (merged) · **Deployed** to `app.resumetailored.com` (Railway deploy `57b49183`, commit `eac3eaa`, status SUCCESS).

Candidate personal sites now resolve at **`{slug}.resumetailored.com`** (URL bar unchanged), and slugs share **one global namespace** with employer career sites.

---

## 1. Shared namespace
New **`lib/tenant-resolve.ts`** (server-only, service-role — imported by API routes + the two stores, never by client code or middleware):
- **`resolveTenant(label)`** → `"career" | "site" | null` (checks `career_sites`, then `personal_sites`).
- **`isSlugTaken(slug, { careerEmployerId?, personalUserId? })`** → true if the slug is claimed on **either** side, **regardless of published state** ("reserved means reserved"), excluding the caller's own row. **Fails safe** (errors → treated as taken, so a glitch never hands out a colliding slug).

Both builders consult it:
- Employer `isSlugAvailable` (career-site PATCH + `/api/employer/career-site/slug-available`) now also rejects personal-site collisions.
- Candidate `publishSite` now also rejects career-site collisions.
- Neutral error copy: **"That address is taken"** (never reveals which side owns it).

## 2. Middleware resolution
On a tenant **root `/`**, middleware fetches **`/api/tenant-resolve?label=…` on the canonical `APP_ORIGIN`** (`https://app.resumetailored.com`) — never the subdomain, so no Cloudflare-Worker loop; `/api/tenant-resolve` is never a root path so it's never rewritten (no recursion). Then it rewrites to:
1. **`/careers/{slug}`** if the resolver says `career`,
2. **`/site/{slug}`** if it says `site`,
3. **`/careers/{slug}`** on `null` or any failure (→ the friendly careers "not found" page).

`x-original-host` precedence (#490) is preserved; non-root paths (assets, `/jobs/:id` apply flows) pass through unchanged; a 2.5s timeout + try/catch keep the edge resilient.

## 3. Candidate Web Studio UI
- `publishSite` now **rejects** an invalid or taken custom address (previously it silently substituted a random-suffixed slug); the publish route maps that to **409/400** with a readable message.
- New **`GET /api/personal-website/slug-available`** (auth) for live checks.
- The Publish panel shows **`{slug}.resumetailored.com`** as the primary address with `app.resumetailored.com/site/{slug}` as the smaller alternate, plus live availability status — matching the employer career-site builder (#489).

## Constraints honored
- No new dependencies; public reads keep their existing patterns; service-role stays server-side (middleware calls the API, never imports the store). `whoami` untouched (still pending removal). `tsc` ✅ · `next lint` ✅ · `next build` ✅ · Railway deploy **SUCCESS**.
- Endpoint sanity check (live): `GET /api/tenant-resolve?label=zzz-nope-12345` → `{"type":null}`; `?label=app` → `{"type":null}` (reserved rejected).

## Verify (DNS-dependent)
Once `*.resumetailored.com` resolves:
1. An existing **published** personal-site slug → `{slug}.resumetailored.com` renders the site (URL bar unchanged).
2. A career-site slug still renders its careers page at its subdomain.
3. Unknown slug → friendly not-found.
4. Cross-side conflict: typing a career-site's slug in the Web Studio address (or a personal slug in the career-site builder) is rejected with "That address is taken."

## Notes / follow-ups
- **Per-request resolve fetch:** each tenant root hit makes one internal call to `/api/tenant-resolve`. It's a same-provider hop with a short timeout and graceful fallback; if you later want it faster, we can add a short edge cache (KV/`unstable_cache`) keyed by label.
- **Unpublished personal site:** resolves to `/site/{slug}`, which 404s (its own "site not published" page) — reservation still holds so the slug can't be taken by someone else.
- **Old-slug redirects** (from #489) still not implemented — renaming a slug 404s the old address. Say the word for a cross-namespace alias table + 301.
- **`/api/whoami`** is still live — tell me when to remove it.

## Unrelated, still open
- Pre-existing `test` (homepage-nav) failure on `main` — unrelated.
- Phase 1B remaining: **Video Interviews** + **DocuSign**.
