# ResumeTailored AI — Website Project Summary
**Session Date:** 2026-05-28  
**Owner:** marvinperson11@gmail.com  
**Repository:** marvinperson11-debug/resumetailor  
**Live URL:** Railway deployment (auto-deploys from `main` branch)

---

## What This Project Is

ResumeTailored AI is a SaaS product that uses Claude AI (claude-sonnet-4-6) to tailor resumes and generate cover letters based on job postings. It charges $19/month via Stripe and offers 1 free tailoring/day on the free tier.

**Stack:**
- Backend: Node.js + Express (`server.js`) — all API routes, auth, Stripe, Claude API, file parsing, .docx generation
- Frontend: Plain HTML/CSS/JS — no framework, no build step
- Database: SQLite via `better-sqlite3` (in-memory fallback if `DATA_DIR` not set)
- Deployment: Railway (auto-deploy from GitHub `main` branch)
- AI: Anthropic Claude API (`claude-sonnet-4-6`)
- Payments: Stripe ($19/month subscription)
- Email: Resend API (optional) or SMTP fallback, or console log

---

## Environment Variables (set in Railway dashboard)

| Variable | Purpose | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude AI API | Yes |
| `STRIPE_SECRET_KEY` | Stripe server-side | Yes |
| `STRIPE_PUBLISHABLE_KEY` | Stripe client-side | Yes |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing | Yes |
| `STRIPE_PRICE_ID` | Stripe Price ID (`price_...`) | Yes |
| `RESEND_API_KEY` | Real email sending via Resend | Optional |
| `OWNER_EMAIL` | Where owner notifications go | Optional (defaults to `marvinperson11@gmail.com`) |
| `DATA_DIR` | SQLite persistence path (e.g. `/data`) | Optional (Railway Volume) |
| `PORT` | Server port | Optional (defaults to 3000) |

---

## Everything We Built / Changed Today

### 1. Landing Page Full Redesign (`public/index.html`)
- **Old:** Dark theme, gold accents, unreadable hero mockup
- **New:** Clean white background, blue (#2563eb) accents, Inter font — inspired by resume.com
- Sections built:
  - Sticky white nav with logo, links, "Get Started" CTA, hamburger mobile menu
  - Hero with headline, subheadline, CTA button, "1 free tailoring · No payment required" note
  - Before/After AI transformation demo card (see §6 below)
  - How It Works (3 steps)
  - Features section (4 alternating rows with emoji icons)
  - Scrollable Template Gallery with Resume/Cover Letter tabs (see §7)
  - Testimonials (3 cards)
  - Blue/purple gradient CTA banner
  - FAQ accordion
  - Pricing cards (Free + Pro)
  - Footer with links + contact email

**Key design choices:**
- Self-contained CSS (no `style.css` dependency) — prevents dark theme bleed
- All `!important` overrides removed after decoupling from `style.css`
- Mobile hamburger shows full-screen overlay (not a dropdown)
- `body { background: #fff; color: #111827; }`

### 2. Favicon (`public/favicon.svg`, `favicon-32.png`, `favicon.png`, `favicon-192.png`, `apple-touch-icon.png`)
- Blue rounded square (#2563eb), white document shape, gold star badge
- Generated via `@resvg/resvg-js` from `generate-favicon.js` in project root
- Linked in all HTML pages: `<link rel="icon" href="favicon.svg">`

### 3. SEO Optimization (`public/index.html`)
- `<title>`: "ResumeTailored AI — AI Resume Tailor & Cover Letter Generator"
- Meta description targeting "AI resume tailor" + "AI cover letter"
- Meta keywords: ai resume tailor, resume optimizer, ATS resume, cover letter generator, etc.
- Open Graph tags (`og:title`, `og:description`, `og:image`, `og:url`)
- Twitter Card tags
- Canonical URL: `https://resumetailored.com`
- JSON-LD `SoftwareApplication` schema with `Offer` ($0 free, $19 pro) and `AggregateRating`

### 4. Secondary Pages Redesigned (all white/blue, self-contained CSS)

| Page | Changes |
|---|---|
| `public/about.html` | Full white rewrite: 5-step how-it-works, 8 why-cards, comparison table vs competitors, testimonials, blue CTA banner |
| `public/cancel.html` | Full white rewrite: cancellation form (POST `/api/contact`), FAQ accordion, retention CTA; `submitCancel()` + `toggleFaq()` JS preserved |
| `public/success.html` | White card: "You're Pro now!" with 8 perks grid, blue CTA → `/app.html` |
| `public/reset-password.html` | White card: token verification + password reset JS fully preserved, blue focus rings |

### 5. Email & Owner Notifications (`server.js`)

#### Password Reset Flow
- User requests reset → gets white/blue branded email with reset link (1 hour TTL)
- **You (marvinperson11@gmail.com) ALSO get a notification email** every time any user requests a reset, including their email address and timestamp
- Reset email updated from old dark gold theme to white/blue design matching new site

#### Contact Email
- All support emails go to `marvinperson11@gmail.com` (set via `OWNER_EMAIL` env var or hardcoded default)
- `cancel.html` form → `POST /api/contact` → delivered to your email
- Footer, cancel page, and error messages all use `marvinperson11@gmail.com`

#### Email Sending Priority
1. Resend API (if `RESEND_API_KEY` set in Railway)
2. SMTP (if `SMTP_USER` + `SMTP_PASS` set)
3. Console log (fallback — reset link printed to Railway logs)

**To enable real emails:** Add `RESEND_API_KEY` in Railway dashboard (get key from resend.com, it's free).

### 6. Before/After Demo Section (`public/index.html`)
Replaced the original unreadable mockup with a clean two-column card:
- **Left (Before):** Gray background, red ✕ badge, grayed-out bullets in soft boxes, red "❌ Rejected by ATS · Zero callbacks" footer
- **Middle:** Blue circular arrow with "AI tailors" label
- **Right (After):** White background, green ✓ badge, blue-highlighted bullets with left accent border, green "✅ 97% ATS match · 3 interviews week 1" footer
- Fully responsive (stacks vertically on mobile)

### 7. Template Gallery (`public/index.html`)

#### Templates Available (30 total)
**Resume Templates (15):**
Classic (FREE), Modern (FREE), Executive, Minimal, Creative, Professional, Tech, Elegant, Bold, Contemporary, Academic, Compact, Sharp, Neutral, Vivid

**Cover Letter Templates (15):**
Classic (FREE), Modern (FREE), Executive, Minimal, Creative, Professional, Tech, Elegant, Bold, Contemporary, Academic, Compact, Sharp, Neutral, Vivid

**Marketing copy:** "100+ templates" (covers all future additions)
**Free tier:** Classic + Modern (resume & cover letter)
**Pro tier:** All templates

#### Template CSS (`public/style.css`)
New template classes added:
- `.tpl-academic` — Georgia serif, small-caps section titles
- `.tpl-compact` — tight spacing, 12.5px font
- `.tpl-sharp` — red (#dc2626) accents
- `.tpl-neutral` — warm stone tones (#78716c)
- `.tpl-vivid` — teal (#0d9488) accents
- Matching cover letter variants: `.tpl-cl-academic-cover`, etc.

#### Gallery UX
- Scrollable left/right with `‹` `›` arrow buttons (`scrollGallery()` function — renamed from `scroll` to avoid browser API conflict)
- Visual mockup cards: colored header band + simulated text lines (no longer uses scaled-down resumes that looked awful)
- **Free template cards:** "Use Template →" blue button → opens `/app.html`
- **Pro template cards:** "🔒 Unlock with Pro" button → opens modal with upgrade CTA

### 8. Pro Upgrade Modal (Template Gallery)
When clicking a pro template, a clean modal appears:
- Shows the template name
- Explains it's a Pro feature
- Two buttons: "Upgrade to Pro — $19/mo →" and "Try Free Templates First"
- Closes on backdrop click or Cancel button

### 9. Advertising Assets (`public/ads/`)
Five SVG advertising files created (open in browser, screenshot for PNG):

| File | Size | Use Case |
|---|---|---|
| `instagram-post.svg` | 1080×1080 | Instagram feed — before/after resume comparison |
| `facebook-post.svg` | 1200×628 | Facebook / LinkedIn — dark blue split with resume mockup |
| `twitter-post.svg` | 1200×675 | Twitter/X — "3× more interviews" stat-forward |
| `youtube-thumbnail.svg` | 1280×720 | YouTube — dark dramatic "0 callbacks → 3 interviews" |
| `story-ad.svg` | 1080×1920 | Instagram/Facebook Stories — full vertical |

All use white/blue color palette matching the website. Text and CTAs are fully editable in any text editor.

---

## Key Architecture Notes

### Auth Flow
- Sessions use UUID tokens in browser `localStorage` (`rt_token`, `rt_email`, `rt_username`)
- Server validates via `GET /api/auth/me`
- `app.html` forces auth modal if no valid token

### Free Tier Gating
- 1 free tailoring/day per IP
- Tracked by `${ip}_${date}` key in SQLite `usage` table
- Resets naturally at midnight

### Stripe Webhook
- `POST /webhook` must use `express.raw()` — already set up correctly
- `STRIPE_WEBHOOK_SECRET` required for signature verification
- Events handled: `checkout.session.completed` (adds subscriber), `customer.subscription.deleted` (removes subscriber)

### Important: In-Memory State Warning
All data resets on server restart unless `DATA_DIR` is set (Railway Volume). To persist data:
1. Create a Railway Volume
2. Set `DATA_DIR=/data` in Railway env vars
3. SQLite database will be stored at `/data/resumetailor.db`

---

## Git & Deployment

**Branches:**
- `main` → Railway auto-deploys from this branch
- `claude/claude-md-docs-9Li8u` → feature branch used for all development

**To deploy changes:**
```bash
git checkout main
git merge claude/claude-md-docs-9Li8u
git push origin main
# Railway auto-deploys within 2-5 minutes
```

**After Railway deploys:**
- Hard refresh browser: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Or test in incognito window to bypass cache

---

## Important File Map

```
resumetailor/
├── server.js              ← entire backend (DO NOT split — one file by design)
├── package.json
├── railway.json           ← Railway build/start config
├── generate-favicon.js    ← run once to regenerate favicon PNGs
├── new_website.md         ← this file
└── public/
    ├── index.html         ← landing page (white/blue design)
    ├── app.html           ← main SPA dashboard (dark theme — intentional)
    ├── style.css          ← template CSS + app styles (dark theme)
    ├── about.html         ← how it works page (white)
    ├── cancel.html        ← cancellation page (white)
    ├── success.html       ← post-payment page (white)
    ├── reset-password.html← password reset page (white)
    ├── favicon.svg        ← primary favicon
    ├── favicon-32.png
    ├── favicon.png
    ├── favicon-192.png
    ├── apple-touch-icon.png
    └── ads/
        ├── instagram-post.svg
        ├── facebook-post.svg
        ├── twitter-post.svg
        ├── youtube-thumbnail.svg
        └── story-ad.svg
```

---

## Note on app.html (Dark Theme)

`app.html` is the actual resume-building dashboard. It is intentionally dark — it's a professional tool interface, not a marketing page. When any "Get Started" or "Use Template" button is clicked from the landing page, it opens `app.html`. This is NOT the old website — it is the working app where users tailor their resumes.

The old dark **landing page** (index.html) has been replaced. `app.html` was always and remains the app.

---

## Troubleshooting

| Issue | Likely Cause | Fix |
|---|---|---|
| Buttons show old version | Browser cache | `Ctrl+Shift+R` or open incognito |
| Buttons show old version | Railway still deploying | Wait 2-5 min after push |
| No reset emails | `RESEND_API_KEY` not set | Add in Railway dashboard |
| Data lost on restart | `DATA_DIR` not set | Add Railway Volume + set `DATA_DIR=/data` |
| Stripe webhook failing | Wrong `STRIPE_WEBHOOK_SECRET` | Copy from Stripe dashboard → Webhooks |
| Templates not showing in app | Template ID mismatch | IDs in `app.html` must match CSS classes in `style.css` |
