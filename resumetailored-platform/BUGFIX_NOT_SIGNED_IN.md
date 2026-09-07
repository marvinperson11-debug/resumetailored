# Bug fix — "Build My Resume" showed `not_signed_in` while signed in

## What was happening
Clicking **Build My Resume** (and other tools) returned a red `not_signed_in`
error even though you were signed in (dashboard visible, sidebar "Pro · active").

## Root cause
It was **not** a second/conflicting auth check in the modal, and the middleware
already covers `/api/*`. The problem was *how* each API route read the session:

- Every route used **`currentUser()`** from `@clerk/nextjs/server`.
- `currentUser()` does two things: verify the session token **and** make a
  Clerk **Backend API** round-trip to fetch the full user object.
- The dashboard page, by contrast, uses the lightweight **`auth()`** (token
  verify only, no network call) — and it works for you (that's why the
  dashboard renders and stats load).
- So the session was valid; only `currentUser()`'s extra Backend API step was
  coming back empty in the server runtime, and our routes read that as
  "not signed in" → 401.

## The fix
Switched **every** API route from `currentUser()` to `auth()` + `userId` — the
exact same check the dashboard already uses. This is lighter, has no external
dependency, and cannot disagree with the page-level auth. No new auth check was
added; the existing one was corrected.

Routes changed:
- `/api/tailor`, `/api/cover-letter`, `/api/ats-scan`
- `/api/fetch-job-url`, `/api/extract-text`
- `/api/resumes` (GET + POST), `/api/resumes/[id]` (DELETE)

Also: the 401 responses now carry a friendly `message` ("Your session expired.
Please refresh and sign in again.") so the tool never surfaces a raw
`not_signed_in` code again — though with this fix a signed-in user won't hit it.

`/api/create-checkout-session` was intentionally left on `currentUser()`: it
needs your email (which `auth()` doesn't provide), it's the upgrade flow (not
this bug), and you're already Pro — changing it would risk that flow for no
benefit here.

## Verify after deploy
Open the AI Resume Builder → paste/upload a resume + a job posting → **Build My
Resume**. It should generate with no red error. ATS, Cover Letter, URL import,
file upload, and My Resumes use the same corrected check.

## Questions for you
1. If, after this deploys, you *still* see `not_signed_in`, that would point to
   the session cookie not reaching the API on your setup (rare). Tell me and
   I'll add explicit credential handling to the client fetches and check the
   Clerk domain/proxy config — but the evidence says `auth()` will resolve it.
2. Nothing else needed from you — the Supabase migration you ran covers
   autosave + My Resumes.
