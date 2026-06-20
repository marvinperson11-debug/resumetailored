---
name: ckm:site-check
description: "Run, smoke-test, and review the ResumeTailor website. Use when the user wants to check the site, test the app, find broken pages or links, review page content/SEO, audit the landing/blog/SEO pages, or verify that features (tailoring, auth, ATS scan, Stripe checkout) work. Actions: check site, test website, smoke test, audit pages, review copy."
argument-hint: "[run | pages | content | features | all]"
license: MIT
metadata:
  author: claudekit
  version: "1.0.0"
---

# Site Check

End-to-end health check for the ResumeTailor AI website (Express backend in `server.js`, static frontend in `public/`). Runs the app, smoke-tests routes, scans HTML pages for problems, reviews content/SEO, and exercises key features. This skill checks the existing site — it does not build new features.

## When to Use

- "Check my website" / "Is the site working?" / "Test the app"
- "Find broken pages or links"
- "Review the landing / blog / SEO pages"
- "Make sure tailoring / auth / checkout still works"

## Scope modes

The argument picks how deep to go (default `all`):

- `run` — start the server, confirm it boots, hit core routes.
- `pages` — static scan of `public/**.html` for broken links, missing assets, SEO/meta gaps.
- `content` — read key pages and review copy against the positioning in `CLAUDE.md`.
- `features` — exercise API endpoints (health, ATS scan, tailoring, etc.).
- `all` — everything, reported as one prioritized findings list.

## Workflow

### Step 1: Run & smoke-test (`run`)

1. Ensure deps: `npm install` if `node_modules` is missing.
2. Start in background and capture logs:
   ```bash
   PORT=3000 npm start > /tmp/site-check-server.log 2>&1 &
   ```
   Wait until the log shows the server listening (poll the log; don't `sleep` blindly).
3. Smoke-test routes with the helper:
   ```bash
   python3 .claude/skills/site-check/scripts/smoke_routes.py --base http://localhost:3000
   ```
   It checks public pages, redirect routes (`/app`→`/dashboard`, `/about`→`/how-it-works`), and `GET /api/health`. Report any non-2xx/3xx as findings.
4. Note: full AI/Stripe features need `ANTHROPIC_API_KEY` / `STRIPE_*` env vars. Without them, `/api/health` and page serving still work; AI endpoints will error — flag that as "needs env", not a bug.

### Step 2: Scan pages (`pages`)

Run the static scanner over the `public/` tree:
```bash
python3 .claude/skills/site-check/scripts/scan_pages.py public
```
It flags: local `href`/`src` targets that don't exist on disk, missing `<title>`/meta description, missing canonical/OG tags, and empty links. Group findings by severity.

### Step 3: Review content (`content`)

Read the high-value pages and check copy against `CLAUDE.md` → "Competitive Positioning":
- `public/index.html`, `public/how-it-works.html`
- SEO pages: `public/alternatives/*.html`, `public/*-alternative.html`
- `public/blog/index.html` + recent posts
Check: pricing stated correctly ($19/mo, $129 lifetime), AI model named consistently (Claude `claude-sonnet-4-6`), value props present, no placeholder/lorem text, no broken internal CTAs.

### Step 4: Exercise features (`features`)

With the server running, test endpoints (see `references/endpoints.md` for the full list and example payloads). Always-safe checks (no external keys needed):
- `GET /api/health`, `GET /api/status`, `GET /api/forum`
- `GET /api/auth/me` — expect 401 without a token (that's correct, not a failure)
Key-dependent (only if env is set): `POST /api/tools/extract-keywords` and `POST /api/ats-scan`, `POST /api/tailor` (need `ANTHROPIC_API_KEY`); `POST /api/subscribe` (needs `STRIPE_*`). If a key is missing, report "skipped — no key" rather than failing.

### Step 5: Report

Produce one prioritized list: **Broken** (404s, dead links, crashes) → **Content** (wrong pricing, inconsistent model name, typos) → **SEO/meta** (missing tags) → **Needs env** (features untestable without keys). Then stop the background server.

## Cleanup

Always kill the server you started:
```bash
pkill -f "node server.js" 2>/dev/null || true
```

## References

- `references/endpoints.md` — route inventory and example request payloads for feature testing.
