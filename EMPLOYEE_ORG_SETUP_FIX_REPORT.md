# Fix: New Employees Landing on "Setup your organization" / `/candidate`

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Clerk + Supabase)
**Branch:** `claude/employee-hr-platform-phases-a22afj` (restarted from `main` after #534–#537 merged)
**Draft PR:** [#538 — Route staff to /employee everywhere + confirm create-path binding](https://github.com/marvinperson11-debug/resumetailored/pull/538)
**Checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅

No schema change. No new npm deps.

---

## Progress confirmed
The branded account-creation flow works — the invitee ends up **signed in as the invited email**. The remaining problem was *where they landed afterward*: Clerk's **"Setup your organization"** screen, and on any redirect through the app root, the **candidate** dashboard.

## Two root causes

### 1. The role router sent workforce employees to `/candidate` (app bug — fixed)
`app/page.tsx` is the single role-router that **every post-auth flow funnels through** — including the `ClerkProvider` fallback (`signInFallbackRedirectUrl="/"`). Its logic was:

```
if (canUseEmployerPortal(access)) → /employer
else → /candidate
```

Workforce employees are **deliberately excluded** from `canUseEmployerPortal` (that's how they're kept out of the employer portal), so they fell through to **`/candidate`**. Fixed by adding a staff branch first:

```
if (isStaffEmployee(access)) → /employee     // NEW, before the others
if (canUseEmployerPortal(access)) → /employer
else → /candidate
```

Because this router sits at the funnel, a staff user now reaches `/employee` **no matter where the redirect came from** — including after any Clerk task screen or the auth fallback URL.

### 2. "Setup your organization" is a Clerk *instance* session task — not app code
That screen (logo, org name, Continue) is Clerk's **forced organization-creation session task** (`TaskChooseOrganization`), enabled at the **Clerk instance** level. This app models every role via Clerk `publicMetadata` (`plan: "employer" | "employee" | …`) and **does not use Clerk Organizations at all**, so forced org creation should not apply to anyone. A session task injected by the instance **cannot be deleted from application code**, so:

- **Definitive fix (you, one Clerk Dashboard setting):** Clerk Dashboard → **Organizations** → turn **off** "force users to create or join an organization." After that, no user sees "Setup your organization."
- **In code**, the flow is made resilient regardless: the accept page now **hard-navigates** (`window.location.assign("/employee")`) after ticket sign-in so a lingering client-side task/SPA state can't strand the new hire, and — with fix #1 — wherever the flow lands, staff route to `/employee`.

## Binding confirmed before redirect (explicitly requested)
`POST /api/employee/accept/create` now **verifies the employee row is bound before handing back the sign-in ticket**: `linkClerkUser(...)` is retried once, and if it still fails the request **errors instead of signing the user in unlinked**. This guarantees:
- the employee shows as **linked / "Portal active"** on the employer side before the redirect;
- portal access (which resolves via `clerk_user_id`) works on first load.

(The binding also sets `invite_status = accepted` and clears the token + 6-digit code, so the invite is single-use.)

## Files
| File | Change |
|---|---|
| `app/page.tsx` | Root role-router: `isStaffEmployee → /employee` (before employer/candidate) |
| `app/employee/accept/accept-client.tsx` | Hard-navigate to `/employee` after sign-in |
| `app/api/employee/accept/create/route.ts` | Confirm bind (retry once) before minting the ticket |

## Verification (honest)
- `tsc` / `lint` / `build` green (after clearing the stale `.next/` cache).
- A **live Clerk round-trip** (real ticket sign-in with the org task pending) could not be exercised in the sandbox. Fix #1 is deterministic server routing; the resilience of fix #2 depends on the Clerk instance — the **Dashboard setting is the guaranteed removal** of the org-setup screen.

**Suggested smoke test:**
1. **After turning off forced org creation in Clerk**, invite a new employee → accept with code + password → should land directly in `/employee` (no "Setup your organization").
2. Immediately check the employer's Employees list → the employee shows **Portal active** (bound) before/at the time they land.
3. Sign the same employee out and back in (through `/` ) → they route to `/employee`, not `/candidate`.

## PR status
- **#534–#537** — merged to `main`.
- **#538** — draft, awaiting your review/merge (and the one Clerk Dashboard toggle).
