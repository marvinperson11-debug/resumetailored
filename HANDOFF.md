# ResumeTailor AI — Agent Handoff Document

## Goal
Build and launch a live SaaS product called **ResumeTailor AI** that charges $19/month and uses the Claude API to tailor resumes and generate cover letters from job postings. Target: $5,000/month in recurring revenue from the $200 starting budget.

---

## Current Progress

### ✅ Fully Built (code is complete and ready)
All files are at: `C:\Users\marvi\Desktop\Credit Report\resumetailor\`

| File | Status |
|---|---|
| `server.js` | ✅ Complete — Express backend, Claude API, Stripe, free-tier gating |
| `public/index.html` | ✅ Complete — Landing page with pricing |
| `public/app.html` | ✅ Complete — Main tool UI |
| `public/style.css` | ✅ Complete — All styles |
| `public/success.html` | ✅ Complete — Post-payment page |
| `railway.json` | ✅ Complete — Railway deployment config |
| `package.json` | ✅ Complete |
| `node_modules/` | ✅ Installed — 124 packages, 0 vulnerabilities |
| `.env` | ⚠️ Partially filled (see below) |

### ✅ Node.js
- Node.js v24.15.0 is installed at `C:\Program Files\nodejs\`
- Use `& "C:\Program Files\nodejs\node.exe"` and `& "C:\Program Files\nodejs\npm.cmd"` to run

### ✅ API Keys Collected So Far
The `.env` file at `C:\Users\marvi\Desktop\Credit Report\resumetailor\.env` currently has:
- `ANTHROPIC_API_KEY` ✅ filled
- `STRIPE_SECRET_KEY` ✅ filled (test key — redacted)
- `STRIPE_PUBLISHABLE_KEY` ✅ filled (test key — redacted)
- `STRIPE_WEBHOOK_SECRET` ❌ empty — not yet obtained
- `STRIPE_PRICE_ID` ❌ empty — product not yet created in Stripe
- `PORT=3000` ✅

---

## What Worked
- **winget** successfully installed Node.js v24.15.0 (`winget install OpenJS.NodeJS.LTS`)
- **npm install** succeeded using full path: `& "C:\Program Files\nodejs\npm.cmd" install`
- **PowerShell System.Drawing** can generate PNG images without extra installs
- **Chrome MCP** (`mcp__Claude_in_Chrome__*`) works for tabs it opens, but **cannot access** `dashboard.stripe.com` or `platform.claude.com` due to extension host permissions
- **Computer-use screenshots** work for reading the screen (Chrome is read-only tier — can see but not click)
- User's Stripe account is already set up and open in Chrome

---

## What Didn't Work
- **Chrome MCP cannot navigate to `dashboard.stripe.com`** — blocked by extension host permissions. Don't try again.
- **Chrome MCP cannot navigate to `platform.claude.com`** — same restriction.
- **`file://` URLs** don't work in the Chrome MCP extension tab group.
- **Bash tool** cannot find `npm` or `node` — must use full Windows paths via PowerShell.
- **Computer-use cannot click or type in Chrome** — Chrome is granted at tier "read" only.
- The PowerShell PNG generation script ran but it's unclear if the file saved (timed out checking). Check `C:\Users\marvi\Desktop\resumetailor-product.png` — it may or may not exist.

---

## Next Steps (in order)

### Step 1 — Create the Stripe Product & get Price ID
The user needs to do this in their open Stripe dashboard:
1. Go to `dashboard.stripe.com` → **Product catalog** → **+ Create product**
2. Name: `ResumeTailor Pro`
3. Description: `Unlimited AI-powered resume tailoring and cover letter generation.`
4. Upload image: `C:\Users\marvi\Desktop\resumetailor-product.png` (if it exists) or skip
5. Price: `$19.00` USD, Monthly recurring
6. Click **Add product**
7. Copy the **Price ID** (starts with `price_...`) from the product page
8. Paste it into `.env` as `STRIPE_PRICE_ID=price_...`

### Step 2 — Fill remaining .env values
Edit `C:\Users\marvi\Desktop\Credit Report\resumetailor\.env`:
- `STRIPE_PRICE_ID=price_...` ← from Step 1
- `STRIPE_WEBHOOK_SECRET=whsec_...` ← set this up AFTER deployment (needs live URL)

### Step 3 — Test the server locally
```powershell
cd "C:\Users\marvi\Desktop\Credit Report\resumetailor"
& "C:\Program Files\nodejs\node.exe" server.js
```
Then open `http://localhost:3000` in browser to verify it works.

### Step 4 — Deploy to Railway
1. Go to [railway.app](https://railway.app) and sign up/log in
2. New Project → Deploy from GitHub (push the folder to GitHub first) OR use Railway CLI
3. Add all `.env` variables in Railway dashboard
4. Railway auto-assigns a public URL (e.g. `resumetailor-production.up.railway.app`)

**Railway CLI install** (if needed):
```powershell
& "C:\Program Files\nodejs\npm.cmd" install -g @railway/cli
railway login
railway init
railway up
```

### Step 5 — Set up Stripe Webhook
1. In Stripe dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://YOUR-RAILWAY-URL/webhook`
3. Events: `checkout.session.completed` and `customer.subscription.deleted`
4. Copy the **Webhook signing secret** (`whsec_...`)
5. Add to Railway env vars as `STRIPE_WEBHOOK_SECRET`

### Step 6 — Switch Stripe to Live mode
Currently using TEST keys. When ready to accept real payments:
1. Toggle to "Live" in Stripe dashboard
2. Get live `sk_live_...` and `pk_live_...` keys
3. Create the product again in Live mode, get new `price_live_...`
4. Update Railway env vars with live keys

### Step 7 — Marketing (free channels)
- Post on Reddit: r/resumes, r/jobs, r/GetEmployed with before/after examples
- List on Product Hunt
- Post on LinkedIn with a demo

---

## Important Notes
- The app uses **in-memory storage** for free-tier usage and subscriber tracking. This means data resets on server restart. Fine for MVP, but for production add a database (SQLite or Postgres on Railway).
- Stripe keys in `.env` are currently **TEST** keys — no real charges will happen until switched to live.
- The business name in Stripe is "Communtiy Resources" (the user's existing Stripe account name). This can be updated in Stripe settings later.
- Budget spent so far: **$0** (all free tools used). Node.js = free, Railway has a free tier.

---

## File Locations Quick Reference
```
Project root:   C:\Users\marvi\Desktop\Credit Report\resumetailor\
.env file:      C:\Users\marvi\Desktop\Credit Report\resumetailor\.env
Product image:  C:\Users\marvi\Desktop\resumetailor-product.png (may exist)
Node.js:        C:\Program Files\nodejs\node.exe
npm:            C:\Program Files\nodejs\npm.cmd
```
