# ResumeTailored AI Audit Report

**Audit date:** August 21, 2026

**Audit branch:** `fix/full-audit-2026-08-21`

**Scope:** Local source review, automated HTTP/integration tests, dependency audit, and rendered Chromium checks against a local server.

## 1. Summary

This audit fixed the critical deep-link routing failures, closed several client-supplied identity/paywall bypasses, repaired resume-photo data passed to DOCX export, made free generators resume automatically after authentication, corrected the mobile New Tools/creator toolbar rules, protected share-link creation, and updated the existing welcome email's stale pricing copy. A cold-load race found during rendered testing on `/website` was also fixed.

The application is materially safer and its requested core routes now resolve locally. It is **not ready to be declared fully production-verified**: live AI, Stripe, email delivery, Remotion rendering, deployed Railway behavior, database backups, and physical browser/device coverage require credentials and infrastructure that are not present in this checkout. Career Hub and Employer Portal are confirmed to remain freemium, matching the repository's authoritative product rules and test contract.

## 2. Issues Fixed

| Requested issue | Status | Result |
|---|---|---|
| SPA/server routing | **Fixed locally** | `/pricing`, `/checkout`, `/forgot-password`, `/tailor`, `/cover-letter`, `/website`, `/video`, `/tools`, all four `/app/*` routes, and `/api/health` return the intended shell/JSON on direct requests. `/tools` is handled before static directory canonicalization. Pricing/checkout enter the pricing section. |
| Session persistence | **Fixed/validated locally** | The existing 30-day HTTP-only session cookie remains the source of truth across routes. Server authorization no longer trusts query/body email values for status, DOCX Pro access, video, translation, LinkedIn optimization, or sharing. Existing auth/session/CSRF tests pass. |
| Mobile bottom control bar | **Fixed locally** | The bar remains visible on Dashboard, New Tools, and non-immersive browsing/upgrade states. It is absent on the public landing page and hidden only inside active website/video creator experiences. The New Tools overlay now stops above the fixed bar. |
| Photo in final output | **Fixed for the identified DOCX regression** | Templated DOCX export now sends `window.rtResumePhoto`; it previously sent the unrelated video-photo variable. Existing PDF/share rendering already uses the resume photo. Real exported files with every template/device still need live visual QA. |
| Generate share link | **Fixed locally** | Share creation now requires a valid session and derives ownership from it. The client preserves the pending generation through login and retains existing success/error/clipboard feedback. Anonymous calls and forged identities are rejected. |
| Video paywall for guests | **Fixed locally** | Generation, status polling, and file download require authentication. Generation additionally requires a paid subscription, and jobs are owner-bound. Guest routes show the upgrade/landing state rather than an active studio. |
| Global paid-tool gating | **Partially fixed** | Core Pro document templates, video endpoints, translation/LinkedIn Pro state, and share identity checks are server-authoritative. Existing personal-site/media security suites pass. Career Hub and Employer Portal intentionally retain their documented freemium tiers. |
| Free-tool login flow | **Fixed locally** | All 18 requested tools were audited. Logged-in users use the server-authoritative cookie session without another prompt; logged-out users can browse and fill forms and are prompted only when they invoke Generate/Scan/Save/Compare/Add. Form state and the pending action survive login and replay automatically. Browse-only Resume/Cover Letter Examples remain public. |
| Explicit Back buttons | **Fixed locally** | A centralized explicit parent-route map now covers every requested static tool, in-app tool panel, Career Hub panel, Employer Portal view, Share Link modal, and checkout/billing entry. It never uses browser-history traversal; safe local `returnTo` values may override defaults for known entry flows. |
| Video Creator makeover | **Needs more work** | The current repository already contains a responsive studio, progress states, and a server-side job pipeline. This audit secured and regression-tested that flow, but did not replace it with a new end-to-end visual design. Live video generation could not run without Remotion/runtime credentials. |
| Welcome email | **Application fixed; production DNS blocked** | Signup sends through Resend first (SMTP fallback), with the explicit sender `ResumeTailored AI <support@resumetailored.com>`. The new table-based responsive template includes a preheader, mobile breakpoint, visible unsubscribe link, RFC 8058 headers, and a persistent confirmation-based opt-out flow. Local end-to-end signup/delivery-payload/unsubscribe tests pass. Live SPF and DKIM records are present, but `_dmarc.resumetailored.com` incorrectly CNAMEs to Railway and publishes no DMARC policy; inbox/spam placement cannot pass until DNS is corrected and a controlled production mailbox is tested. |
| Full application audit | **Partially complete** | All 44 repository test entry points pass under Node 20.19.5, including the repository-wide button-integrity suite, free-tool login-flow suite, Back-navigation suite, welcome-email suite, and rendered route checks. Production integrations, real accounts, real devices, and operational database/payment/email checks remain external blockers. |

### Explicit Back navigation targets

| Page/view | Explicit target |
|---|---|
| AI Resume Tailor, Cover Letter, LinkedIn Optimizer, ATS Scanner, Resume Analyzer, Job Tracker, Share Link | `/score` (Free Tools) |
| Readability Review (`/score`) | `/tools` (New Tools) |
| Offer Calculator, Job Decoder, Follow-Up Email, Mock Interview, Keyword Extractor, A/B Test Tracker, Salary Script, Video Creator | `/tools` (New Tools) |
| Resume Examples, Cover Letter Examples | `/score` (Free Tools) |
| Pricing | `/` (Home) |
| Checkout and in-app subscription checkout | `/pricing` |
| Career Dashboard, Skills Lab, Interview Prep, Skills Gap, Job Finder, Scenario Lab, Forum, Salary, Check-In | `/dashboard` |
| Employer sign-in/setup and Employer Dashboard | `/for-employers` |
| Employer Jobs, Candidates, Interviews, Analytics, Messages, Settings/Billing | Employer Dashboard via explicit `nvGo('dashboard')` mapping |

All route links accept only a validated same-origin `returnTo` override and reject absolute, protocol-relative, backslash, and control-character values.

## 3. New Issues Discovered

### Fixed during this audit

- A direct `/website` load could call `loadWebsiteCreator` before the second inline script defined it. The cold-load race produced an unhandled `ReferenceError`; initialization is now safely deferred and the rendered route is console-clean.
- `/api/status`, templated DOCX export, video generation, translation, and LinkedIn optimization accepted client-provided email identity in security-sensitive decisions. They now derive identity from the authenticated session.
- Video job status and download URLs were not owner-bound. They now require the authenticated job owner.
- The dependency tree initially reported **26 vulnerabilities** (5 high, 20 moderate, 1 low). Safe package updates, removal of the unused Sentry/OpenTelemetry chain, and the patched `nanoid@5.1.16` resolution reduced `npm audit` to **0 vulnerabilities**.
- Welcome-email content advertised obsolete limits and pricing.
- `test/site-publish.js` treated Windows CRLF line endings as nine editor/mobile/panel-selection failures even though the asserted production behavior was present. The source-contract input is now normalized, and the entire suite passes.
- `test/render-snapshot.js` reported `link.html` and `site-doc.html` as fully changed solely because checked-out goldens used CRLF while renderer template literals emitted LF. Semantic comparison confirmed no renderer or golden-content change; the strict comparison now normalizes platform line endings and both snapshots pass.
- `test/site-features.js` passes under the supported Node 20.19.5 runtime, confirming its previous Node 24/libuv nonzero exit was environmental rather than an application-test failure.
- Explicit Back navigation is centralized in `public/back-nav.js`; the app mounts controls after lazy panel hydration, and Employer Portal subviews explicitly return to its dashboard.
- `test/static-asset-caching.js` had four Windows-only source-regex failures because its multiline pattern assumed LF. Its input now normalizes CRLF, and the real CSS/JS `no-cache` plus long-lived image/font branches all pass.
- The dashboard free-tool actions had an authentication race and could erase their pending callback while opening the login modal. They now await the cookie-backed session check, preserve the callback, and replay the requested output immediately after login.
- Resume Analyzer/Readability and Keyword Extractor could generate anonymously; Offer Calculator and Salary Script also lacked server-side action gates. Each now permits public form entry but requires a session only at the output action.
- A/B Test Tracker redirected on its background load, and Job Tracker displayed an immediate login wall based on stale client storage. Both now render a public empty/browsable workspace and request login only on Save or Add Application.
- Job Decoder, Follow-Up Email, and Mock Interview were already gated at their action endpoints, but their clients did not consistently preserve and replay form state. They now use the shared continuation flow.
- All 52 locked template-card CTAs on the English (`/`) and Chinese (`/zh/`) homepages rendered as buttons but had no click action. A delegated handler now opens checkout for every current and future `.tcard-btn-pro` card.
- The button audit covered 382 checked-in HTML pages, 500 buttons, 7,434 links, and 352 distinct internal destinations. No other missing action, duplicate live DOM ID, or genuine dead internal target remained after accounting for runtime-populated publish/company URLs.
- The regression run exposed a Multer 2 large-upload edge case: oversized multipart uploads could reset the client connection or briefly retain their partial temp file. The exact temp path is now tracked, rejected bodies are drained, cleanup is awaited, and the stress fixture streams instead of retaining two 100+ MB buffers.
- The welcome email used flex/grid and gradients that render inconsistently in Outlook and some mobile clients, and it had no unsubscribe mechanism. It now uses a table-based 600px shell with a mobile breakpoint, safe inline styles, a preheader, 44px-class CTA, persistent email preferences, and both visible and RFC 8058 unsubscribe paths.

### Still open

- The startup diagnostics correctly report missing `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, employer Stripe price IDs, and email-provider configuration in the local environment.
- Resend SPF (`send.resumetailored.com`) and DKIM (`resend._domainkey.resumetailored.com`) resolve, but DMARC does not: `_dmarc.resumetailored.com` is currently a CNAME to `nxoh9dmq.up.railway.app`. Remove that CNAME and publish a DMARC TXT record. Start in monitoring mode, for example `v=DMARC1; p=none; rua=mailto:support@resumetailored.com; pct=100`, verify reports/alignment, then advance to `p=quarantine` and ultimately `p=reject`.

## 4. Recommendations

1. Preserve the documented freemium entitlement rules for Career Hub and Employer Portal in client guards, server middleware, Stripe configuration, and regression tests.
2. Add one centralized capability/entitlement middleware and a shared client route guard instead of maintaining feature-specific checks.
3. Add Playwright coverage in CI for direct routes, login continuation, mobile toolbar states, owner-bound downloads, checkout return paths, and visual export snapshots on Node 20.
4. Keep dependency auditing in CI. If application observability is needed later, add and configure a current telemetry SDK deliberately rather than retaining an unused runtime dependency.
5. Keep future tool pages in the centralized explicit parent map and pass a validated local `returnTo` value when an entry flow needs a more specific origin.
6. Run staging acceptance tests with Stripe test-mode webhooks, Resend/email sandboxing, Anthropic, Remotion, and seeded free/Pro/employer accounts. Verify webhook signature handling, retries, idempotency, cancellation, refunds, and entitlement downgrade.
7. Document and test encrypted database backups and a restore drill. Add integrity/orphan checks and query-plan/index review against production-shaped data.
8. Complete accessibility and Core Web Vitals testing with axe/Lighthouse and manual keyboard/screen-reader review; these cannot be proven by source inspection alone.
9. Correct the production DMARC record, confirm the sending domain is verified in Resend, and run inbox-placement tests to controlled Gmail, Outlook, and Apple/iCloud accounts before declaring deliverability passed.

## 5. Testing Results

### Step 9 — Credentialed production integrations (August 21, 2026)

Executed under Node 20.19.5 using the local `.env`, an isolated temporary SQLite database, Stripe test mode, the configured Anthropic account, and the configured Resend account. No production configuration or live-mode Stripe data was changed. Because the configured monthly price was the placeholder `your_stripe_price_id_here` and no lifetime price was configured, the suite created two temporary test-mode prices, used them, then deactivated/archived the fixtures. Temporary test customers were deleted and subscriptions were canceled.

| Area | Result |
|---|---|
| Stripe isolation and temporary prices | **Pass** — secret was test-mode; temporary recurring and one-time prices were usable and cleaned up. |
| Monthly Checkout | **Pass** — hosted Checkout Session created with the expected recurring price; a real test-mode subscription activated and canceled. |
| Trial | **Partial/fail** — Stripe itself successfully created a trialing subscription, but ResumeTailored's `/api/subscribe` Checkout Session contains no trial configuration. |
| Lifetime checkout | **Pass** — one-time hosted Checkout Session created and the signed completion webhook granted the lifetime entitlement. |
| Webhooks and cancellation | **Pass** for valid signature, monthly/lifetime grants, and cancellation revocation. |
| Refund | **Partial/fail** — Stripe created and completed the refund, and the signed `charge.refunded` webhook returned 200, but the app has no refund handler and left the lifetime entitlement active. |
| AI generation | **Pass** — real Claude request generated a combined tailored resume and cover letter (HTTP 200). |
| Welcome, reset, and payment email triggers | **Pass** — all three were accepted by Resend (HTTP 200). |
| Welcome, reset, and payment email delivery | **Fail** — all three reached Resend's terminal `bounced` state because `.env` uses `your@email.com` as the recipient. |
| Subscription-expiry email | **Fail** — no expiry notification trigger or template exists. |
| Video rendering | **Fail** — Remotion downloaded its headless-shell runtime, then the render reached the application's 360-second timeout without producing an MP4. |
| Website publishing | **Pass** — autogeneration, explicit publish, and public rendering all returned successful output. |
| Database backup/restore | **Pass** — online backup returned `integrity_check=ok`, restored account data, and correctly excluded a post-backup marker. |
| Lighthouse/Core Web Vitals | **Fail/inconclusive** — both the full and metrics-only local Lighthouse runs timed out on DevTools `Page.captureScreenshot`. The PageSpeed Insights fallback returned HTTP 429 (daily quota exhausted), so no valid score was produced. |

Hosted Checkout Session creation and the underlying real test-mode subscription/payment/refund lifecycle were exercised separately; the suite did not automate card entry inside Stripe's hosted Checkout page. Signed webhook delivery was exercised directly against the real application handler.

### Passed

- `node --check server.js`
- `node test/audit-regressions.js` — all targeted regression checks passed.
- Direct HTTP checks for every route listed in the critical routing section, including JSON health response.
- Security regression checks for email spoofing, authenticated status, DOCX Pro access, video paywall/ownership, ATS, LinkedIn, and share creation.
- Existing repository suites under Node 20.19.5: **44 of 44 test entry points passed**, including `welcome-email.js`, `button-integrity.js`, `free-tool-login-flow.js`, `back-navigation.js`, `site-features.js`, `render-snapshot.js`, `site-publish.js`, static asset caching, auth/session/CSRF, security, templates, Employer Portal, Career Hub, applications, and media coverage.
- Rendered Chromium checks against localhost for the requested deep links. `/website` was rechecked after the race fix with no console errors.
- Responsive rendered checks at 390×844: New Tools bar visible and unobstructed; public landing has no app bar; guest video/website landing states retain navigation; source and regression checks confirm immersive creator hiding.
- `git diff --check` completed without whitespace errors (Git only reported expected Windows line-ending notices).

### Failed or not completed

| Test area | Result |
|---|---|
| Repository suite | **44/44 entry points pass under Node 20.19.5.** |
| Chrome desktop/mobile, Safari desktop/iOS, Firefox, tablet hardware | Not available in this environment. Local rendered testing used the Codex in-app Chromium browser only. |
| AI generation | Not run: Anthropic key unavailable. |
| Stripe checkout/webhooks (trial, monthly, lifetime, cancellation, refund) | Not run: Stripe secrets/price IDs and a staging webhook endpoint unavailable. |
| Welcome email application flow | **Passed locally:** real signup route, captured Resend API request, sender identity, responsive markup, escaping, visible/RFC unsubscribe links, confirmation route, and persisted opt-out. |
| Welcome/reset/payment/expiry production receipt and spam placement | Not run: live provider credentials and controlled receiving mailboxes unavailable. Welcome DMARC is also blocked by the incorrect production DNS CNAME described above. |
| Video generation end-to-end | Not run: production rendering dependencies/credentials unavailable. Route and authorization behavior passed. |
| Website builder end-to-end publish | Local publishing, drafts, renames, subdomain routing, editor, mobile picker, panel selection, and media ownership checks pass. A production domain/publish environment was unavailable. |
| Database backup/restore and production consistency | Not run: no production database or backup system was supplied. Local persistence tests passed. |
| Full photo matrix (file types, sizes, all templates, all devices) | The identified wiring regression is fixed and asserted; exhaustive visual exports remain staging/device QA. |
| Core Web Vitals and email deliverability | Require deployed origins and external measurement; not claimed. |

## Files Changed

- `server.js` — route fallbacks, authenticated identity enforcement, video/share protections, branded email sender, welcome-email generation, and persistent unsubscribe routes/preferences.
- `emails/welcome.html`, `.env.example`, `test/welcome-email.js` — mobile-safe welcome template, documented sender/public URL settings, and signup-to-unsubscribe regression coverage.
- `public/app.html` — login continuation, direct-route mapping, photo export fix, creator state, website cold-load fix.
- `public/free-tool-auth.js`, `public/tools-hub.js`, `public/job-tracker.js` — cookie-aware action gating, form restoration, automatic post-login continuation, and browsable anonymous tool states.
- `public/index.html`, `public/zh/index.html` — checkout actions for every locked template-card CTA.
- Standalone analyzer, ATS, keyword, offer, salary, decoder, follow-up, interview, and A/B tool pages — login only at their output-producing action and corrected account-requirement copy.
- `public/css/app.css` — mobile toolbar/overlay and immersive creator rules.
- `public/index.html` — pricing/checkout deep-link behavior.
- `public/back-nav.js`, `public/site-nav.js` — centralized explicit parent-route map and shared Back-control mounting.
- `public/employer.html` — explicit Employer Home/Dashboard Back controls for auth, setup, dashboard, settings/billing, and all portal subviews.
- `public/login.html` — forgot-password deep-link presentation.
- `package.json`, `package-lock.json` — safe dependency updates.
- `test/audit-regressions.js` — targeted regression coverage for the fixes above.
- `test/free-tool-login-flow.js`, `test/tools.js` — all 18 requested free-tool flow contracts and server-side anonymous/signed-in action behavior.
- `test/button-integrity.js`, `scripts/audit-buttons.js`, `scripts/audit-links.js` — repository-wide button/link action inventory and internal-target verification.
- `test/media-upload-disk.js` — memory-stable streamed hard-limit fixture; verifies clean 400 responses and deterministic partial-file cleanup.
- `test/site-publish.js` — cross-platform line-ending normalization for multiline source-contract checks.
- `test/render-snapshot.js` — strict cross-platform snapshot comparison after line-ending normalization.
- `test/back-navigation.js` — route-map coverage and a regression guard against browser-history Back controls.
- `test/static-asset-caching.js` — cross-platform line-ending normalization for the source contract.
