# Custom "Login with Google" — Removal Report

**Branch:** `claude/remove-custom-google-login-rl71nu`
**PR:** [#474 (draft)](https://github.com/marvinperson11-debug/resumetailored/pull/474)
**Date:** 2026-09-12

## The problem

A bespoke **"Continue with Google"** flow had been added *separately* from the
platform's real auth. It ran its own OAuth round-trip and opened its own
session, independent of the primary sign-in. The result was the double login you
saw: a user signed in with Google, then had to authenticate a **second** time.

Google sign-in never needed custom code. The platform uses **Clerk**, and Clerk
offers Google (and GitHub, etc.) as a **native OAuth provider** enabled in the
Clerk dashboard — a single one-step redirect through the standard sign-in modal.

## Where the custom code actually lived

The Next.js + Clerk app (`resumetailored-platform/`) was **already clean** — its
`<SignIn>` / `<SignUp>` pages and `<UserButton>` use only Clerk, and Google was
never wired with custom code there. The custom Google login lived entirely in the
**legacy Express app** (the "old site files" flagged in the task):

| File | What was removed |
|---|---|
| `server.js` | The whole custom Google OAuth flow: `GET /api/auth/google`, `/callback`, `/session`, `/status`; the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` config; the redirect-URI helper; and the CSRF state map. |
| `public/app.html` | The "Continue with Google" / "Sign up with Google" buttons in the auth modal, and their `startGoogleLogin` / `initGoogleLogin` / `handleGoogleLoginReturn` JavaScript + page-load dispatch. Helper copy adjusted. |
| `public/login.html` | The Google OAuth button, the `oauth('google')` branch, and the `/api/auth/google/status` probe. |
| `public/js/i18n-data.js` | The `google_login_btn` / `google_signup_btn` strings (English + Simplified Chinese). |
| `.env.example` | The `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` block. |

**Diff:** 5 files, +14 / −165 lines.

## What was deliberately kept

- **Clerk's native OAuth** — `<SignIn>`, `<SignUp>`, `<SignInButton>` /
  `<SignUpButton>` semantics, and `<UserButton>`. Untouched. Google works in one
  step from the Clerk modal.
- **LinkedIn OAuth** and **email/password** auth in the Express app.
- **`autoapply/`** — a *separate* product (job auto-fill dashboard) that uses
  **NextAuth** with Google as its **sole, native** login. It has no Clerk and no
  double-login problem, so its Google provider is that app's only way in.
  Removing it would break all sign-in there — left as-is on purpose.

## What you need to do in the Clerk dashboard

No code change enables Google — Clerk does. Confirm in the Clerk dashboard:

1. **User & Authentication → Social Connections → Google → enabled.**
2. (Optional) For production, add your own Google OAuth credentials in that same
   panel so it doesn't use Clerk's shared dev credentials.

That's the only place Google should ever be configured now.

## Verification

- **`next build` on `resumetailored-platform`: ✓ Compiled successfully** (exit 0,
  no errors/warnings).
- **Express test suite:** passing. The only 2 failing checks
  (`homepage-ui-bugs.js`, homepage nav ordering) are **pre-existing and
  unrelated** — confirmed by re-running them against the base commit; they touch
  files not modified here.
- **Repo-wide grep:** no dangling references to the removed routes, functions,
  buttons, or i18n keys. The only remaining `GOOGLE_CLIENT_*` matches are in
  `autoapply/`, kept intentionally.

## Result

Users click **"Sign in with Google"** inside the Clerk modal → **one** redirect →
signed in. No second auth step, no custom Google code.

## Deploy

The change is pushed and a draft PR is open. Merging `#474` to `main` deploys via
the existing pipeline (Railway). Before/at deploy you may also remove the now-unused
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` environment
variables from the Express service in Railway — nothing reads them anymore.
