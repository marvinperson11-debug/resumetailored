# Employee Invite Flow Fix + Phone Removal — Report

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Clerk + Supabase)
**Branch:** `claude/employee-hr-platform-phases-a22afj` (restarted from `main` after #534/#535 merged)
**Draft PR:** [#536 — Fix employee invite flow (accept escapes staff gate) + hide phone from UI](https://github.com/marvinperson11-debug/resumetailored/pull/536)
**Checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅ (117 pages)

No schema change — migration `0032` (phone + invite_code) is already applied.

---

## 1. Invite flow — the accept page was dead-ending on the explainer

### Root cause (why "no sign-in prompt, no code entry anywhere")
The invite email link **already** pointed at `/employee/accept?token=…` (requirement 1a was in place). The real bug was structural: `/employee/accept` lived **under** `app/employee/layout.tsx`, and that layout is the **staff-only gate** — for any request without a resolved staff `employeeContext()` it returns the explainer and **never renders its children**. So an anonymous invitee's request was intercepted by the layout and painted the static explainer; the accept page's own `redirect(/sign-in…)` and the code-entry form were never reached. That's the exact "device with no session → lands on explainer and stops" symptom.

### Fix — a route group so accept escapes the gate
Moved the gated portal into an `app/employee/(portal)/` **route group**. Route groups (`(name)`) do **not** affect URLs, so every path is byte-for-byte unchanged; they only change which `layout.tsx` wraps a route.

| Before | After | URL |
|---|---|---|
| `app/employee/layout.tsx` | `app/employee/(portal)/layout.tsx` | — (shell) |
| `app/employee/page.tsx` | `app/employee/(portal)/page.tsx` | `/employee` |
| `app/employee/documents/*` | `app/employee/(portal)/documents/*` | `/employee/documents` |
| `app/employee/messages/*` | `app/employee/(portal)/messages/*` | `/employee/messages` |
| `app/employee/time-off/*` | `app/employee/(portal)/time-off/*` | `/employee/time-off` |
| `app/employee/training/*` | `app/employee/(portal)/training/*` | `/employee/training` |
| `app/employee/library/*` | `app/employee/(portal)/library/*` | `/employee/library` |
| `app/employee/accept/*` | **unchanged** (now outside the group) | `/employee/accept` |
| `app/employee/components/*` | **unchanged** | — |

Because `/employee/accept` is now a sibling of the group, the portal layout no longer wraps it, and its own logic runs end-to-end:

- **(a)** Invite link → `/employee/accept?token=…` (already correct; verified).
- **(b) Auth required.** Anonymous → `redirect(/sign-in?redirect_url=/employee/accept?token=…)`. Clerk's sign-in page offers sign-up one click away; both return to the accept URL. Signing up with the invited email lands directly on the code step.
- **(d) Code entry.** Signed-in + email matches a pending invite → the 6-digit code-entry form (`accept-form.tsx`). `POST /api/employee/accept` binds the account only when token + email + code all check out; a wrong code returns an error and the form allows retry; the code is single-use (cleared on bind).
- Signed-in **wrong account / used-or-bad token** → a specific message (not the generic explainer).
- **(c) Explainer is signed-in-only.** Middleware bounces anonymous visitors from every `/employee` route **except** `/accept`, so by the time the `(portal)` layout renders the explainer, the caller is always signed in with no matching pending invite (wrong account / already accepted / not invited).

Middleware was already correct: `/employee(.*)` is protected, with `/employee/accept` exempted so it can host its own sign-in redirect. No middleware change was needed.

## 2. Phone removed from the UI

- Removed the phone field from the **Add-employee form** and the **employee drawer/detail** — state, inputs, the read-only row, and the POST/PATCH bodies. Status returns to full width in both places.
- **Kept** the `employees.phone` DB column and the store's read/write support (harmless; ready for SMS later) — it's simply not shown.
- Stripped the "SMS delivery coming later" line from the drawer invite panel. **Confirmed no SMS references** remain in the invite **email copy** or the **explainer/gate page**; the only other mention was an internal code comment in the invite route, which I also cleaned up.

---

## Files

| Area | Change |
|---|---|
| Route group | 9 files moved into `app/employee/(portal)/` (git renames, history preserved); layout's component imports fixed to `../components/…` |
| Employer UI | `app/employer/employees/employees-client.tsx` — phone removed from Add form + drawer; SMS line stripped |
| Invite route | `app/api/employer/employees/[id]/invite/route.ts` — docstring de-SMS'd (behavior unchanged) |

## Verification (honest)
- `tsc --noEmit`, `next lint`, `next build` all green after clearing the stale `.next/` cache (its pre-move generated type stubs were the only tsc errors; a fresh build regenerates them for the new paths).
- The build shows `/employee/accept` as its own 2.4 kB route (the client code-entry form) separate from the portal pages — confirming it no longer inherits the portal layout.
- A real Clerk sign-in/sign-up round-trip wasn't exercisable in the sandbox, but the redirect and gate logic are now structurally reachable (they weren't before).

**Suggested smoke test (no session):**
1. Employer invites an employee → open the invite email on a signed-out device → click the link.
2. Expect the **Clerk sign-in/up** screen (not the explainer). Sign up with the invited email.
3. Land on the **6-digit code** step → enter the code from the email → portal opens. Wrong code → error + retry.
4. Visit `/employee` signed in as a non-member → the **explainer** (no employer upsell, no SMS text).
5. Confirm the employee **Add form and drawer show no phone field**.

## PR status
- **#534, #535** — merged to `main` (Phase 1 + first fixes).
- **#536** — draft, green, awaiting your review/merge. I'm watching it until it merges or closes.
