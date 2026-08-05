# Task Summary — Job Finder fix, Employer Portal, Login, Blog & more

This is the single deliverable document for all the work in this PR. Everything
was implemented, tested locally, and committed to
`claude/job-finder-employer-portal-c2qtf5`.

---

## 0. URGENT — Job Finder was broken (ROOT CAUSE FOUND & FIXED)

### Root cause
The Job Finder depended on a **single** provider — JSearch via RapidAPI. In
production that key returns **HTTP 403 Forbidden**, confirmed directly in the
Railway logs:

```
[refresh-job-feed] JSearch (HVAC Technician): jsearch_403
```

`RAPIDAPI_KEY` **is** set in Railway, but the key is **not subscribed to the
JSearch API** on RapidAPI (JSearch requires an active subscription even on its
free tier, or it 403s). Because the whole feature had one data source, that 403
meant *every* search returned nothing — and it failed **silently** (a 403 got
turned into a generic empty result). Your "HVAC Technician, no location" test
hit exactly this.

Empty location handling was actually already correct — a keyword-only search
does default to nationwide. The problem was 100% the dead single provider +
silent failure.

### The fix — resilient multi-provider search (`job-providers.js`)
Job search now **fans out across every configured provider and merges the
results**. One provider failing (403, quota, network) is logged and skipped —
it can never empty the page again.

Providers, in priority order:
1. **Adzuna** — *env-gated* (`ADZUNA_APP_ID` + `ADZUNA_APP_KEY`). Free signup,
   full **US** coverage across **all sectors including skilled trades** (HVAC,
   electricians, CDL, etc.). This is the recommended primary source for
   nationwide, on-site US search.
2. **JSearch** — *env-gated* (`RAPIDAPI_KEY`). Kept for continuity; skipped
   automatically when it 403s.
3. **USAJOBS** — *env-gated* (US federal jobs).
4. **Remotive, The Muse, Jobicy, Arbeitnow** — **zero-key** fallbacks that
   always work, so the feature is *never* empty.

Behavior:
- **Keyword-only search = nationwide** (an empty location never forces a filter).
- Results are **de-duplicated** across providers.
- Errors are **surfaced, not swallowed**: the API returns a `sources` array and
  distinct status codes — `502` (a keyed provider is down), `503` (nothing
  configured), or a genuine empty result with `onlyFallbacks` noted in the UI.
- `scripts/refresh-job-feed.js` ("Jobs for You" feed) uses the same fan-out.

**Verified locally:** with **zero API keys configured**, a live search returned
**60 real jobs** from the free providers — proving the pipeline works
end-to-end. Unit tests in `test/job-providers.js` (all pass) cover the
normalizers, dedupe, the 403-doesn't-empty-results case, and nationwide search.

### ⚠️ ONE ACTION NEEDED FROM YOU for full HVAC/trades coverage
The zero-key fallbacks are **remote/tech-focused**, so a nationwide *HVAC*
search needs a US-wide source with trades. Two options (either works):

- **Recommended — add a free Adzuna key (2 minutes):**
  1. Sign up at <https://developer.adzuna.com> (free).
  2. In Railway → your service → Variables, add:
     `ADZUNA_APP_ID=<your id>` and `ADZUNA_APP_KEY=<your key>`
     (optionally `ADZUNA_COUNTRY=us`).
  3. Redeploy. HVAC-nationwide and every on-site US search now return full
     results.
- **Or fix the existing RapidAPI key:** log into RapidAPI and **subscribe to
  the JSearch API** (free tier is fine) with the account that owns
  `RAPIDAPI_KEY`. The 403 will clear and JSearch will start returning results.

I could not do either myself — both require signing into your third-party
accounts. Everything on the code side is wired and ready; it's purely an
env-var/subscription step. All the new env vars are documented in `.env.example`.

---

## 1. Removed the LinkedIn Optimizer card from the Resume Tailor tab
The blue "LinkedIn Profile Optimizer" shortcut card inside the Resume Tailor
section is removed (HTML + its CSS), on desktop and mobile. The LinkedIn
Optimizer itself still exists as its own sidebar tab — only the in-tab card was
removed, as requested.

## 2. Real LinkedIn logos everywhere
Replaced every emoji / text-badge "LinkedIn" mark with the **official LinkedIn
"in" brand logo** (inline SVG): the "Continue with LinkedIn" auth button, the
Optimizer panel header, the "Save as PDF" how-to modal, the landing-page
feature icon, and the pricing-card bullets. (The generic 🔗 used for
"Share as Link"/"URL" is not a LinkedIn logo and was left alone.)

## 3. Resume Tailor button text → "Get Tailored"
The main tailor button now reads **"Get Tailored →"** in all states (default,
cover-letter mode, post-submit) and the i18n default was updated.

## 4. New-features pricing shown as promotional/advertising cards
- **Landing page:** a new **"✨ What's New"** section with marketing-style promo
  cards (badges + pricing) for the **Employer Portal**, **Resume Video**,
  **Personal Website**, and **Career Hub**, each with a CTA.
- **Dashboard:** a **"✨ What's New"** sidebar button opens a matching promo
  modal, so the new-feature pricing is also accessible from inside the app.

## 5. Login page — Sign In / Create Account + Google + Employer Portal
- The auth modal now has a clear **Sign In / Create Account** tab toggle
  (email + password signup was restored — it had no UI before).
- **Google Sign-In (OAuth / OpenID Connect)** added, mirroring the existing
  LinkedIn flow: "Continue with Google" / "Sign up with Google" buttons on both
  tabs. Gated by `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; the button is
  hidden until those are set (graceful, like LinkedIn). See `.env.example` for
  the 3 vars and the redirect URI to register in Google Cloud Console.
- A **separate Employer Portal** call-to-action is in the auth modal (distinct
  from the job-seeker login) linking to `/employer`.
- **Your Employer Portal access:** your email (`marvinperson11@gmail.com`) is
  already in `COMP_EMAILS` and is treated as a **Pro Employer** — so signing in
  with your existing credentials and opening `/employer` gives you full access
  (you'll set a company name once to turn on Hire Mode — a single field).

## 6. Employer Portal — distinct recruiter dashboard + landing showcase
Rebuilt `public/employer.html` as a **visually distinct navy/slate recruiter
dashboard** with its own sidebar — **no job-seeker tabs** except a single
"Job Seeker Dashboard" link. Navigation:
**Dashboard | Jobs | Candidates | Interviews | Analytics | Messages | Settings |
Job Seeker Dashboard.**

- **Dashboard:** stat cards (Active Postings, Applications This Week, Candidates
  in Pipeline, Interviews Scheduled), Recent Activity feed, Quick Actions.
- **Jobs:** table (Title / Location / Posted / Applications / Status), post &
  edit modal (title, description, requirements, location, salary range, job
  type, deadline/gig fields), applicant view with the **New → Reviewed →
  Interview → Hired → Rejected** pipeline, one-click reject email.
- **Candidates:** searchable/filterable list (profession, location, remote
  preference, gig availability), candidate profile modal, message & schedule.
- **Interviews:** schedule (video/phone/onsite) — sends the candidate an invite
  email — plus complete/cancel/delete.
- **Analytics:** hiring funnel chart, average time-to-hire, applications-by-
  source, and **CSV export** (with spreadsheet formula-injection guard).
- **Messages:** threaded candidate conversations with an unread badge.
- **Settings:** company profile (logo, description, website), notification
  preferences, billing/upgrade.
- **Landing page:** the Employer Portal is showcased as a **key feature** (icon,
  description, mock dashboard visual, "Open the Employer Portal →" CTA) plus a
  **"For Employers"** nav link (desktop + mobile).

Backend: new `interviews` and `employer_messages` tables; `employer_profiles`
gained logo/description/notification columns; new routes for overview,
interviews, messaging, analytics, settings, and CSV export. Pure, unit-tested
helpers (`buildFunnel`, `computeTimeToHire`, `toCsv`, `validateInterview`).
Existing employer tests all pass; new endpoints verified with a live end-to-end
smoke test (post job → applicants → interview → message → analytics → settings
→ CSV).

## 7. Two SEO-optimized blog posts
Both live, indexable, with OG tags, `BlogPosting` schema, meta description
**under 160 chars**, semantic H1/H2/H3, and 2–4 internal links each (to each
other, the landing page, pricing, dashboard, and existing posts). `.md` sources
and blog-index cards added.

- **`/blog/employer-portal-for-recruiters`** — "How Recruiters Can Streamline
  Hiring with ResumeTailored AI's Employer Portal." Targets *employer portal,
  recruiter dashboard, hiring platform, applicant tracking system, ATS for small
  business, candidate management software, job posting platform.*
- **`/blog/resume-website-builder`** — "Build a Professional Resume Website in
  Minutes with ResumeTailored AI." Targets *resume website builder, personal
  website creator, portfolio website tool, online resume, professional website
  for job seekers, free website builder for resumes.*

---

## 8. Google Search Console — URLs to submit

**Fastest path:** submit the sitemap once — it already lists **324 URLs** and
now includes the two new posts. In GSC → *Sitemaps*, submit:

```
https://resumetailored.com/sitemap.xml
```

### Brand-new URLs from this PR — request indexing directly (GSC → URL Inspection → "Request indexing")
```
https://resumetailored.com/blog/employer-portal-for-recruiters
https://resumetailored.com/blog/resume-website-builder
```

### About the Employer Portal page
`/employer` is intentionally **`noindex`** — it's a functional
recruiter app/login surface, not a content page (same reasoning as the login
page you asked to exclude). **Do not submit `/employer` to GSC.** Its
*indexable* SEO landing page is the blog post above
(`/blog/employer-portal-for-recruiters`) plus the "For Employers" feature block
on the homepage, which are the URLs that should rank.

### Orphan check — result: none
I cross-checked every blog post on disk against the sitemap: **all 25 blog posts
are in the sitemap** (no orphans). All 70 role `*-resume` / `*-cover-letter`
pages, seniority variants, hub pages, alternatives pages, and free tools are
already in the sitemap too.

### Key existing URLs worth confirming are submitted (high-value, easy to miss)
```
https://resumetailored.com/                         (homepage)
https://resumetailored.com/blog/                     (blog index)
https://resumetailored.com/resume-examples           (head-term hub)
https://resumetailored.com/cover-letter-examples     (head-term hub)
https://resumetailored.com/how-it-works
https://resumetailored.com/score                     (free ATS tool)
https://resumetailored.com/tools/ats-keyword-extractor
https://resumetailored.com/tools/resume-video
https://resumetailored.com/alternatives/teal
https://resumetailored.com/alternatives/jobscan
https://resumetailored.com/alternatives/rezi
```
For the complete, authoritative list (all 324 URLs — every role page, seniority
variant, alternative, and blog post), rely on `sitemap.xml`; submitting it
covers everything above without pasting hundreds of links.

**Excluded on purpose (do not submit):** the login/app dashboard (`/dashboard`),
the Employer Portal (`/employer`) — both functional/`noindex` — and any
share-link (`/r/:slug`) or badge pages (also `noindex`).

---

## 9. Testing done
- `node test/job-providers.js` — **ALL PASS** (new).
- `node test/career-hub.js`, `test/employer-hub.js`,
  `test/employer-portal-routes.js` — **ALL PASS** (unchanged behavior).
- Live server smoke tests: server boots clean (0 migration errors); Job Finder
  returns 60 live jobs with no keys; Employer Portal post-job → applicants →
  interview → message → analytics → settings-save → CSV export all verified;
  Google-status endpoint returns `{enabled:false}` until configured; blog posts,
  sitemap, dashboard, and landing all serve `200`.

## Open questions / notes for you
1. **Job Finder full coverage** needs the Adzuna key (or a re-subscribed
   RapidAPI/JSearch key) — the only manual step, detailed in §0. Without it the
   feature still works but returns mostly remote roles.
2. **Google Sign-In** is code-complete but dormant until you add
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see `.env.example`).
3. The **Pro Employer** plan uses `STRIPE_EMPLOYER_PRICE_ID` (already set in
   Railway) at $29/mo; the upgrade button is wired to it.
4. Candidate-side *replies* to employer messages send/receive via email today;
   a dedicated job-seeker messaging inbox UI can be a fast follow if you want
   in-app two-way threads on the candidate side.
