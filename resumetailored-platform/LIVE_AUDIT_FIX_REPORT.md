# Live-site audit (Sept 30, 2026) — fix report

Branch: `claude/live-audit-fixes` (committed locally, **not pushed, not deployed**).
Checks run: `tsc --noEmit` ✅ · `npm run lint:i18n` ✅ · `next build` ✅ (dummy Clerk keys) · `node --check server.js` ✅.
**Not run:** any browser/visual check, any live Stripe call. Items marked 🔍 need a human eyeball.

Status key: ✅ fixed in code · 🟡 partly fixed / needs owner decision · ⛔ not done (reason given)

## Phase 1 — revenue-critical
| # | Status | What changed |
|---|---|---|
| 1 | ✅ | All Upgrade CTAs now go to `/employer-checkout?plan=…` via one helper, `employerCheckoutHref()` in `app/employer/components/ui.tsx`. Free→`portal`, Portal→`scale`, Scale→`corporate`; feature-locked banners use the tier the feature needs. Covers the sidebar plan footer, locked-module banner, snackbar, quota bars, upgrade card, Team/Jobs/Candidates/Docs quota CTAs, career-site "Upgrade →", and the full-page employer gate (`components/locked-feature.tsx` → `plan=portal`). Settings has a new upgrade link. **Decision:** the "individual account hits the Employer Portal" gate now links to Portal checkout; previously it was a "Learn about" marketing link. |
| 2 | ✅ | Office page now shows the standard "…is part of the Scale plan. Upgrade to activate — everything you set up will be waiting." banner whenever any Scale tool is locked (Calculators stay usable). Note the existing copy says **Scale**, matching the tier the code actually gates on (the audit text said Portal). |
| 3 | ✅ | Chose the label fix: "Free: 5 practice questions · Mock interview is Pro" (English only — see follow-ups). The mock button already shows a lock for Free users. |

## Phase 2 — trust
| # | Status | What changed |
|---|---|---|
| 4 | ✅ | "100% Free · No Account Required" → "Free to start · No credit card required" (EN+ZH, `index.html`, `zh/index.html`); FAQ answer and `cancel.html` reworded to "just a free account"; `score.html` eyebrow. 🟡 I left "no sign-up" on the ATS checker pages/flyers/blog OG images because I could not confirm the ATS scan is account-gated — please confirm. |
| 5 | ✅ | Candidate Settings free-plan text now states real limits (watermark, 6 templates, Decoder 3/day, translation limit, Resume Video & Personal Website are Pro). EN only. |
| 6 | ✅ | Marketing now says **1 active job post** (matches `JOB_POSTING_LIMITS.free = 1`) on `for-employers.html` and `features/job-posting.html`. 🟡 The legacy `public/employer.html` still says "2 job posts (lifetime)"; that page is the retired old portal, left alone. **If you'd rather keep "2", change `JOB_POSTING_LIMITS.free` instead.** |
| 7 | ✅ | Display-only clamp: sidebar + `QuotaBar` show "3 of 3", never "7 of 3". Sends were already enforced server-side (`checkSendAllowance` → 402); the >max count comes from history carried across plans/admin preview. |
| 8 | ✅ | `/pricing/` now 301s to `/pricing` (`server.js`). |
| 9 | 🟡 | I could not find two separate $19 "Professional"/"Executive" plans in this repo — those are template names. Lifetime $129 is already on the landing pricing section. No pricing changes made. **Owner: point me at where you saw them.** |
| 10 | ✅ | Footer "Contact Us" now has a real `mailto:support@resumetailored.com` href (still opens the contact modal for JS users). |
| 11 | ✅ | `/cancel` and `/cancel.html` were being 301'd to the app sign-in by the "deprecated routes" list. Removed them so the existing cancellation page (instructions + form → `/api/contact`) is reachable; its `/dashboard` links now go to `app.resumetailored.com`. |

## Phase 3 — features
| # | Status | What changed |
|---|---|---|
| 12 | 🟡 | Decoder: likely root cause was `max_tokens: 900` truncating JSON mid-object (→ "bad decode" generic error). Now 1800 (basic) / 4000 (deep) plus one silent retry on unparseable output. Quota is **3/day** (was 1 in code, 3 in your audit — **please confirm 3 is intended**), returned from a new `GET /api/decoder/decode`, shown as "x of 3 free decodes used today" in the tool, with a clear daily-limit state. 🔍 I could not reproduce the 5/6 failure (no API key), so reliability is unverified. |
| 13 | 🟡 | Counter added for Decoder; sends/seats/jobs/candidates/documents already had bars. Mock interview is Pro-only in code (no "1/month" metering exists), so nothing to count. Watermark notice is now in Settings copy. |
| 14 | ✅ | "remote" (or "Remote, TX") in Location is treated as the remote flag and removed from Adzuna's `where`, which was geocoding to nothing. |
| 15 | ✅ | New `lib/keywords.ts` drops junk/proper-noun tokens ("amiad"); applied to the deterministic fallbacks and to the ATS model output. It is a heuristic (no dictionary) — expect an occasional miss. |
| 16 | 🟡 🔍 | Shared `Select`: added `color-scheme: dark`, `min-w-0`, `truncate`. I could not see the original visual failure; verify in a browser. |
| 17 | ✅ | Bad/unsupported URL now shows a message naming supported boards (client check + clearer server message). |
| 18 | ✅ | "Upcoming" now requires a real `scheduledAt`. |
| 19 | ✅ | Locked banner text gets `min-w-[14rem] break-words` so it wraps instead of clipping. 🔍 |
| 20 | ✅ | At the seat limit, Invite opens an "Inviting requires an upgrade" dialog (link → Portal checkout). Server already enforced the cap. |
| 21 | 🟡 | New `lib/job-quality.ts` hides placeholder listings from `/jobs` (title starts with/contains multiple "Any", description < 80 chars, degenerate salary) and blocks publishing such a listing publicly. **The existing Walmart listing is database content — review/remove it in Supabase or via the admin; heuristics are not moderation.** |
| 22 | ✅ | Employer nav "Hire" → "Jobs" (all 5 locales). |
| 23 | ✅ | Candidate nav hides the PRO pill for Pro/employee accounts. |
| 24 | ✅ | Settings → Plan: "Current plan: X", billing note, upgrade link, "Manage billing" (mailto support). 🟡 No Stripe billing-portal route or renewal date exists in the app, so renewal date is described, not shown. |
| 25 | ✅ | Preview banner re-reads the cookie on navigation, tab focus and a switcher event (it only read it once on mount). |

## Phase 4 — copy & polish
| # | Status | What changed |
|---|---|---|
| 26 | ✅ | Hero (EN+ZH). Alternatives considered: (A) **"AI resume tailoring that gets you the interview."** ← implemented; (B) "Paste a job. Get a resume written for it."; (C) "The AI resume tailor that speaks every hiring manager's language." Kicker and lead rewritten to say what the product does. Swap copy in `eco_title/eco_kicker/eco_lead` if you prefer B or C. |
| 27 | ✅ | "Private career & people office" → "AI resume & hiring tools" on all `public/*.html`. |
| 28 | ✅ | Door 1 "Tailor My Resume" now links to `app.resumetailored.com` instead of `/how-it-works`. |
| 29 | ✅ | "Membership" now jumps to `#pricing` (was `/pricing#ecosystem-pricing`, the doors block). |
| 30 | ✅ | `[id]{scroll-margin-top:88px}`. 🔍 |
| 31 | 🟡 | Vocabulary = "<Name> plan" (Free / Portal / Scale / Corporate). Quota CTAs now say "Portal", checkout option "Portal plan", and `for-employers.html` pricing now lists Free/Portal/Scale/Corporate with the real in-app numbers (sends 3/10/50/unlimited, seats 1/3/10/unlimited, 1 job on Free). Prices untouched. Other locales still say "Employer Portal" in a few strings. |
| 32 | ⛔ | There is no "Coming Soon" string on the e-signature page in this repo. The page shows "DocuSign not configured" when DocuSign env vars are missing — likely what you saw on the live deployment. Check `DOCUSIGN_*` env on Railway. |
| 33 | ✅ | `/employee` link on sign-in was a loop (route sits behind the same sign-in) → replaced by explanatory text (5 locales). Slug now strips diacritics ("Résumé" → `resume`). Team row shows "Account owner" for the `owner@account` placeholder. |

## Verify-only
Candidate $19 Stripe checkout labeling: **not verified.** No Stripe keys in this session, and I did not create a live session. Do this with your test keys: hit `POST /api/create-checkout-session`, open the URL, confirm business name and "Resume Tailored" product.

## Follow-ups / caveats
- New/changed strings are English in non-EN locales except where noted (parity check passes; translation needed): decoder quota (ZH done), `seatGuard*`, `officeFeature`, Settings plan keys, `freeQuestions`, `freeDesc`.
- Not browser-tested: #16, #19, #30 and every CTA click-through. Run `test/browser/*` style checks before deploy.
- Checkout for a signed-in *individual* Pro account clicking the employer gate: `claim-free`/checkout handles auth; not exercised.
