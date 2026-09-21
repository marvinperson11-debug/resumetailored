# Phase 1 Fixes — Gate Page + 6-Digit Invite Code + Employee Phone

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Supabase + Clerk + TypeScript)
**Branch:** `claude/employee-hr-platform-phases-a22afj` (restarted from `main` after Phase 1 #534 merged)
**Draft PR:** [#535 — Phase 1 fixes: dedicated employee gate page + 6-digit invite code + employee phone](https://github.com/marvinperson11-debug/resumetailored/pull/535)
**Checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅ · GitHub Actions `test` ✅ (green on head `f827c66`)

---

## Why a new branch/PR

Phase 1 (PR #534) was already **merged** into `main`. Per the branch rules, follow-up work is a fresh change: I reset the same branch onto the latest `main` (which already carries Phase 1 incl. migration `0031`) and pushed these fixes as a new draft PR — no commits stacked on the merged history. The remote branch still held the pre-merge SHAs, so the push was a `--force-with-lease` (allowed, since that history is already merged).

---

## 1. Gate page — no more employer upsell

**Problem:** reaching `/employee` as a user who is **not** a linked staff employee showed *"This feature requires an Employer account"* + an employer upsell — wrong and confusing, since this door is for **invited team members**, not employers.

**Fix:** new `app/employee/components/portal-gate.tsx` (`EmployeePortalGate`), rendered by the `/employee` layout instead of `LockedFeature`:

- **`explain`** (a non-member landed here): a dedicated Employee Portal page — explains this area is for **invited team members** of companies on ResumeTailored, with three steps: **open your invite email → sign in with the email your employer invited → enter your invite code.** No employer upsell, no marketing redirect.
- **`misconfigured`** (metadata says staff, but the employee row can't be resolved): shows **"contact your employer"** instead.

The layout distinguishes the two by re-reading `getAccess()` → `isStaffEmployee(access)` when `employeeContext()` is null.

## 2. Invite code (migration `0032`)

**Schema (`0032_employee_phone_invite_code.sql`, idempotent, hand-applied):**
- `employees.phone text` — optional; editable in the Add form and the drawer; sets up SMS later.
- `employees.invite_code text` — the one-time 6-digit acceptance code.

**Flow:**
- `POST /api/employer/employees/[id]/invite` generates a 6-digit code (`crypto.randomInt`, zero-padded) and stores it on the row. The invite **email shows it prominently** in a large letter-spaced block next to the accept button. Body `action`: `resend` (keep the existing code, re-mint the link, re-email) / `regenerate` (new code) / default (first invite).
- **Acceptance now requires the code.** `/employee/accept` renders a code-entry form (`accept-form.tsx`); `POST /api/employee/accept` binds the account **only** when all of these hold: signed in, valid token, signed-in email matches the invited address, **and** the 6-digit code matches. The code is **cleared on acceptance** (single-use — `linkClerkUser` nulls both token and code).
- **Employer sees the pending state** in the employee drawer: **"Invite pending — code 123456"** with **Resend** and **Regenerate code** buttons; the directory row keeps its Portal status badge (Invited / Portal active).

**Backward compatibility:** a pending invite created before `0032` has no stored code and accepts on token + email alone; clicking **Regenerate** stamps a code onto it.

## 3. Employee phone

Optional `phone` field added to the **Add employee** modal and made editable in the **employee drawer** (saves on blur via the existing PATCH). Read-only for non-managers. Not used for delivery yet.

## SMS — explicitly NOT in this PR

SMS delivery of the invite code needs a provider and is a **future PR**. The email carries the code for now; the UI copy says so.

---

## Files

| Area | Files |
|---|---|
| Migration | `supabase/migrations/0032_employee_phone_invite_code.sql` |
| Types | `lib/employee-hub.ts` (`Employee.phone`, `Employee.inviteCode`) |
| Store | `lib/employees-store.ts` (`generateInviteCode`, code on invite, verify+clear on link, phone in create/update) |
| Invite API | `app/api/employer/employees/[id]/invite/route.ts` (code + resend/regenerate + code in email) |
| Accept | `app/employee/accept/page.tsx`, `app/employee/accept/accept-form.tsx`, `app/api/employee/accept/route.ts` |
| Gate page | `app/employee/components/portal-gate.tsx`, `app/employee/layout.tsx` |
| Employer UI | `app/employer/employees/employees-client.tsx` (phone field, pending code, Resend/Regenerate) |

## ⚠️ Before deploying

Run **`supabase/migrations/0032_employee_phone_invite_code.sql`** against Supabase. Idempotent (`add column if not exists`), safe on a fresh or existing DB, safe to re-run.

## Verification (honest)

- Static checks pass locally: `tsc --noEmit`, `next lint`, `next build` — all new/changed `/employee/*` and API routes compile.
- CI `test` (repo-root suite) is **green** on the PR head; Netlify deploy-preview checks are neutral (its build target is the repo-root site, not the platform subdir — expected).
- Live end-to-end (real Supabase + Clerk invite acceptance + Resend) wasn't exercisable in the sandbox; flows reuse the same helpers as Phase 1.

**Suggested smoke test after applying 0032:**
1. Employer → Employees → open an employee (with email) → **Invite to portal** → drawer shows "Invite pending — code NNNNNN".
2. Open the invite email → the code is shown prominently. Sign in with that email → `/employee/accept` → enter the code → land `/employee`.
3. Wrong code → rejected; wrong account/email → "sign in with that email"; visiting `/employee` as a non-member → the explainer (no employer upsell).
4. **Regenerate code** in the drawer → old code stops working, new one accepts.

## Status of the two PRs

- **#534 (Phase 1)** — merged to `main`.
- **#535 (these fixes)** — draft, green, awaiting your review/merge. I'm watching it until it merges or closes.
