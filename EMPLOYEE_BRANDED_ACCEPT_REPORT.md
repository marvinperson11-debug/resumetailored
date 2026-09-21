# Self-Contained Branded Invite Acceptance — Report

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Clerk + Supabase)
**Branch:** `claude/employee-hr-platform-phases-a22afj` (restarted from `main` after #534/#535/#536 merged)
**Draft PR:** [#537 — Self-contained branded employee invite acceptance (no hosted Clerk pages)](https://github.com/marvinperson11-debug/resumetailored/pull/537)
**Checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅

No schema change (`0031`/`0032` already applied). No new npm dependencies.

---

## The problem
An anonymous invitee clicking the invite link was redirected to the platform's **generic `/sign-in`** (the main website login) via `redirect("/sign-in?redirect_url=…")` on the accept page. That dumped invited employees onto the candidate/employer login surface — the branded invite experience was broken from the first click.

## The fix — one uninterrupted branded flow
The accept page no longer redirects anywhere. From the email link to inside the portal, everything happens on `/employee/accept?token=…` using **Clerk's custom (headless) flow APIs** — the hosted sign-in/up pages are never navigated to.

### Page — `app/employee/accept/page.tsx` (server)
Resolves from the token: the invited **email**, the **company** name, and whether a **Clerk account already exists** for that email (`clerkClient.users.getUserList`). Renders the branded card **"You've been invited to {company}'s team portal"** with the email **read-only**. Invalid/used token → a branded "invite not found" message. No `/sign-in` redirect.

### Client — `app/employee/accept/accept-client.tsx`
A custom Clerk flow via `useSignIn` / `useUser` / `setActive`. Four states:

1. **No account yet** → fields: invite code + create password + confirm.
   `POST /api/employee/accept/create` → verifies token + code → `clerkClient.users.createUser({ emailAddress, password, publicMetadata: {staff…} })` → binds the employee row (consumes the code) → returns a one-time **sign-in ticket** → client `signIn.create({ strategy: "ticket", ticket })` + `setActive` → `/employee`.
2. **Account exists** → fields: invite code + password.
   Client `signIn.create({ identifier: email, password })` (custom password flow, **not** the hosted page) → `setActive` → `POST /api/employee/accept` binds → `/employee`.
3. **Already signed in as the invitee** (e.g. a revisit) → invite code only → bind → `/employee`.
4. **Signed in as someone else** → a "Sign out & continue" step that signs out and reloads the **same branded page** (never the hosted pages).

- **Wrong code / wrong password → inline error, retry.** The code is **single-use** — cleared on a successful create/bind (`linkClerkUser` nulls token + code).
- A duplicate-email race is detected server-side (`accountExists`) and the client switches from the create path to the sign-in path, keeping the entered code.

### Server endpoints
- **New** `POST /api/employee/accept/create` — no session required (the invitee has none yet; the UUID token is the secret and the 6-digit code the second factor). Verifies token + code, guards against an existing account, `createUser` with the password + staff metadata, binds, and mints a sign-in ticket (`signInTokens.createSignInToken`, 10-min expiry). Clerk password-policy errors (weak/pwned) are surfaced inline.
- **Kept** `POST /api/employee/accept` as the authed **bind** endpoint for the existing-account path (verifies token + email match + code, sets staff metadata, consumes the code).
- Invite **email copy** updated: "enter the 6-digit code… you'll choose a password (or sign in if you already have an account)."

## Files
| File | Change |
|---|---|
| `app/employee/accept/page.tsx` | Rewritten: resolve email/company/accountExists; no `/sign-in` redirect |
| `app/employee/accept/accept-client.tsx` | **New** branded custom-Clerk client (replaces `accept-form.tsx`, deleted) |
| `app/api/employee/accept/create/route.ts` | **New** create-account + ticket endpoint |
| `app/api/employee/accept/route.ts` | Unchanged (authed bind endpoint) |
| `app/api/employer/employees/[id]/invite/route.ts` | Email copy updated |

## Requirements → where satisfied
1. Branded page, email read-only from the token → **page** + **Shell** header. ✔
2. No account → code + create password (+ confirm) → create + ticket → `/employee`. ✔
3. Account exists → code + password → password sign-in + bind → `/employee`. ✔
4. Wrong code/password → inline error + retry; code single-use on success. ✔
5. Never touches hosted Clerk sign-in/up or the candidate/employer side. ✔ (verified: no `redirect('/sign-in…')` remains in the accept flow)

## Verification (honest)
- `tsc` / `lint` / `build` green (after clearing the stale `.next/` cache). `/employee/accept` builds with the Clerk client flow bundled; `/api/employee/accept/create` is present.
- A **live** Clerk round-trip (real `createUser`, ticket redemption, password sign-in) could not be exercised in this sandbox — there's no live Clerk instance. The flow uses Clerk's documented custom-flow APIs and I verified their exact signatures against the installed `@clerk/backend` types.

### Dependency on Clerk instance config
Server-side `createUser` with a password and **ticket** sign-in require the Clerk instance to have **password authentication** and **sign-in tokens** enabled (both are the defaults for this app, which already uses password auth). Newly created accounts enter via the ticket, so email-verification gating doesn't block first entry.

**Suggested smoke test (no session):**
1. Invite an employee → open the link signed out → see the branded "invited to {company}'s team portal" card (not `/sign-in`), email read-only.
2. New invitee: enter code + a password + confirm → lands in `/employee`.
3. Existing account: enter code + password → lands in `/employee`; wrong password → inline error; wrong code → inline error + retry.
4. Reuse the link after acceptance → "invite not found".

## PR status
- **#534, #535, #536** — merged to `main`.
- **#537** — draft, awaiting your review/merge. I'm watching it until it merges or closes.
