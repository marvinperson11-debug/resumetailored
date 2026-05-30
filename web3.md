# ResumeTailor AI — Project Log
**Site:** resumetailored.com  
**Stack:** Node.js/Express (server.js), plain HTML/CSS/JS (public/), Railway deployment, Stripe, Anthropic Claude API, SQLite  
**Last updated:** May 29, 2026

---

## What We Built / Changed

### Blog & SEO
- Created 5 blog articles: ATS filters, resume tips, how to tailor, cover letters, salary negotiation
- Wired `/blog` route and added Blog to nav, footer, mobile menu
- Added internal linking between all 5 articles (inline links + Related Articles cards)
- Added full OG/Twitter meta tags to every page (social media previews)
- Added `noindex` to private pages (app.html, success.html, reset-password.html, cancel.html)
- Added markdown versions of all blog articles for AI crawlers
- Created `public/llms.txt` for AI search engine discoverability
- Updated sitemap.xml with all blog URLs
- Added keywords: "free resume tailor", "AI resume builder", "resume scanner" across all pages

### App Features
- **Per-mode free tier:** Users now get 1 free resume tailoring + 1 free cover letter per day (tracked separately by IP + mode + date in SQLite)
- **AI error fix:** `consumeFreeTier()` now only runs AFTER Claude returns successfully — failed AI calls no longer consume the user's free use
- **PDF download:** Added red PDF button using jsPDF alongside existing Word and Text download buttons
- **Mobile bottom navigation:** Replaced the top horizontal scroll tab bar with a fixed bottom nav bar (56px, standard mobile UX like Gmail/Instagram)
- **Upgrade button fix:** Added try/catch to `subscribe()` — silent failures now show a clear error message
- **Centered pro box:** `text-align: center` on the sidebar "Unlock Full Access" box
- **Mobile upgrade banner:** Free-tier users on phones/tablets see an upgrade CTA in the main content (since the sidebar pro box is hidden on mobile)
- **Trust proxy fix:** Added `app.set('trust proxy', 1)` so Railway returns the real client IP instead of the shared proxy IP (this was blocking ALL free users after just 1 use)
- **Better error messages:** AI errors now return specific messages for 401 (auth), 429 (rate limit), 500 (busy) instead of one generic message
- **Health check:** `GET /api/health` returns which env vars are configured (true/false)
- **AI test endpoint:** `GET /api/test-ai` makes a minimal Anthropic API call and returns the raw result — useful for diagnosing API issues

### Infrastructure
- **Startup warnings:** Server logs clearly if ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, or STRIPE_PRICE_ID are missing
- All changes go to branch `claude/website-bugs-content-oTjMj`, merged to `main` via squash PRs
- Railway auto-deploys from `main` (when working — see issue below)

---

## Current Issue — AI Still Not Working

### Root Cause Diagnosed
The Anthropic API is returning errors. Here's the sequence of errors we saw:

1. **"Your credit balance is too low"** — No API credits. Fixed by adding $5 on console.anthropic.com.
2. **"Could not resolve authentication method"** — ANTHROPIC_API_KEY variable name was typed as `ANTHROPIC_API_KE` (missing the Y). Fixed in Railway Variables.
3. **"model: claude-3-5-sonnet-20241022 not found"** — Switched model to `claude-3-haiku-20240307`.
4. **"model: claude-3-haiku-20240307 not found"** — BOTH models returning 404. This means the account cannot access ANY Claude model.

### Current Status
- API key: ✅ Set correctly (`ANTHROPIC_API_KEY` in Railway Variables)
- Credits: ✅ $5.00 added on console.anthropic.com
- Model access: ❌ All models returning 404 "not_found_error"
- Railway auto-deploy: ❌ Stopped auto-deploying after some PRs — Railway shows recent deployments as "REMOVED"

### What Needs to Be Done Next

#### 1. Fix Anthropic API Access
The account has credits but no model access. Most likely causes:
- The Anthropic account is new and hasn't been fully provisioned for API access
- The workspace needs billing/plan verification

**Action:** Go to **console.anthropic.com → Settings → Billing** and check if you're on the "Build" plan or if there's a verification step needed. You can also contact Anthropic support at support.anthropic.com explaining you have credits but get 404 on all models.

#### 2. Fix Railway Auto-Deploy
Railway stopped auto-deploying from the main branch. Recent merges (PR #32, #33) show as "REMOVED."

**Action:** Go to Railway → your resumetailor service → **Settings** tab → check the GitHub source connection. Make sure it's linked to `marvinperson11-debug/resumetailor` and set to auto-deploy from `main`. If disconnected, reconnect it.

#### 3. Verify Fix with Test Endpoint
Once the Anthropic issue is resolved, visit:
```
resumetailored.com/api/test-ai
```
It should return: `{"success":true,"modelUsed":"...","response":"ok"}`

---

## Railway Environment Variables (Required)
| Variable | Status | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Set | Rotate the old exposed key if not done |
| `STRIPE_SECRET_KEY` | ✅ Set | |
| `STRIPE_PRICE_ID` | ✅ Set | |
| `STRIPE_PUBLISHABLE_KEY` | ✅ Set | |
| `STRIPE_WEBHOOK_SECRET` | Unknown | Needed for subscription events |
| `RESEND_API_KEY` | ✅ Set | For password reset emails |
| `OWNER_EMAIL` | ✅ Set | Where support messages go |
| `DATA_DIR` | ✅ Set | SQLite database location |
| `NODE_ENV` | ✅ Set | |

---

## Key URLs
- **Live site:** https://resumetailored.com
- **Dashboard:** https://resumetailored.com/app
- **Blog:** https://resumetailored.com/blog
- **Health check:** https://resumetailored.com/api/health
- **AI test:** https://resumetailored.com/api/test-ai
- **Railway:** https://railway.app
- **Anthropic Console:** https://console.anthropic.com
- **GitHub repo:** https://github.com/marvinperson11-debug/resumetailor

---

## Security Notes
- The ANTHROPIC_API_KEY (`sk-ant-api03-9My...`) was exposed in a screenshot. A new key named "resumetailor" was created and set in Railway. Delete the old "new" key from console.anthropic.com if not already done.
- Passwords are SHA-256 hashed (not bcrypt) — noted as not production-grade in CLAUDE.md
- All state is in-memory (Maps) + SQLite — resets on server restart except SQLite data
