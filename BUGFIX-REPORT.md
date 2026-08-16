# Post-merge Bug Investigation & Fixes

Branch: `claude/resumetailored-dashboard-refactor-4mjgrq`
All root causes derived from the codebase; each fix verified against a running server. All 39 backend tests pass.

## The single root cause behind most of it

Phase 2 introduced cookie auth but left **two legacy, header-only auth readers** in place, and the separate front-end modules still sent a **bearer token that is now empty**. Together those produced almost every symptom you saw. The header said "Log Out" (app.html authenticates via the cookie), but feature after feature 401'd because it either sent an empty/stale `Authorization: Bearer ` that *shadowed* the valid cookie, or read the token in a way that never looked at the cookie.

Proof (before fix), same valid session cookie on every request:
- `GET /api/career/dashboard` with **no** auth header → **200**
- same, with `Authorization: Bearer ` (empty — what the modules send) → **401**
- `GET /api/resumes` with the cookie → **401** (used a different, header-only resolver)

---

## Fixes by reported bug

### 1a. Tracker — false "Log in" gate  ✅
- **Server** (`server.js` `_resolveSession`): a bearer header is now only accepted if it *resolves to a real session*; otherwise it falls back to the cookie. An empty/stale `Bearer ` can no longer mask a valid cookie.
- **Client** (`job-tracker.js` `mount`): the gate no longer keys off the legacy `localStorage` token (empty for cookie users). It checks the stored email too and lets the API be the authority (a real 401 still renders the gate).

### 1b. Career Dashboard — infinite spinner + false "Please sign in"  ✅
- The server fix above makes the dashboard `GET` authenticate via the cookie (200) instead of 401.
- **Client** (`career-hub.js` `authH`): stops sending an empty `Bearer ` header, so it can never shadow the cookie.

### 2a & 2b. Back Office empty / Link & Video "Nothing to share yet"  ✅
- **Root cause:** `/api/resumes`, `/api/cover-letters`, Back Office, Link and Video all authenticate through **`emailFromToken()`**, a second legacy resolver that read **only** the bearer header — so it returned 401 for every cookie user, and the UI rendered its empty state.
- **Fix:** `emailFromToken()` now delegates to the cookie-aware `getSessionEmail()`. One change fixes all ~12 routes that use it. Verified: save a resume with a cookie → 200, then fetch → the resume comes back.
- If a resume you saved *before* the deploy is still missing after this, that points at data persistence (Railway `DATA_DIR`/Volume) rather than code — see "Please check" below.

### 3. Disappearing bottom nav  ✅ / clarified
- **Job Finder:** its sticky action bar (`.ch-sticky-bar`, `position:fixed; bottom:0; z-index:900`) sat **on top of** the 62px bottom nav and hid it. Fixed — at ≤480px it now sits *above* the nav (`career-hub.css`).
- **Interview Prep / Skills Gap / Scenario Lab:** these are normal in-shell panels; they looked "dead" only because their content 401'd and rendered empty. The auth fix restores their content, and the fixed bottom nav was never actually removed.
- **New Tools:** this opens a **modal** (not a tab). It covers the nav like any modal, but it has a × button *and* tap-outside-to-close — it's an expected overlay, not a trap.

### 4b. Website Creator — blank screen on "Start from a blank site anyway"  ✅ (mitigated + guarded)
- With resumes now loading (2a/2b fix), users who have a resume skip the "Tailor a resume first" modal entirely and open the editor directly.
- For the genuine no-resume path, I wrapped the editor-entry (`loadWebsiteCreator`) in an **error boundary**: any throw now logs to `/api/client-error`, shows a toast, and drops the user back to a usable state instead of a blank white screen.

### 4a. Landing page — laggy scroll  ⚠️ separate, not addressed here
- This is `public/index.html` (the marketing page, ~290 KB), a **different file** from the dashboard this refactor touched. Phase 1's scroll work was scoped to `app.html`. The landing-page scroll needs its own investigation (image sizing, scroll-reveal handlers) and I didn't want to fold an unrelated 290 KB page into this auth-fix change. Happy to do it as a focused follow-up.

---

## Files changed
| File | Change |
|---|---|
| `server.js` | `_resolveSession` header→cookie fallback (never let a bad bearer shadow the cookie); `emailFromToken` delegates to it |
| `public/career-hub.js` | `authH()` omits the empty bearer |
| `public/job-tracker.js` | login gate no longer keys off the legacy token |
| `public/career-hub.css` | Job Finder sticky bar lifted above the bottom nav |
| `public/app.html` | error boundary around the Website Creator entry |

## Please check on your side
- **Data persistence:** if pre-deploy saved resumes are still missing after this fix, confirm Railway has `DATA_DIR=/data` with a **Volume mounted at `/data`** (per `CLAUDE.md`). Without the volume, the SQLite DB — and every saved resume/session — is recreated on each deploy. That would explain missing history and is a config fix, not a code one.

## Verification done
- Auth matrix (empty bearer / stale bearer / valid bearer / cookie-only / no-auth) returns the right codes; CSRF still enforced on non-auth mutations.
- Save → fetch resume round-trips for a cookie user.
- Server + `career-hub.js` + `job-tracker.js` + all app.html inline scripts syntax-check clean; all 39 tests pass.
