# Employee Drawer Fix + Settings Trim — Report

**Repo:** `marvinperson11-debug/resumetailored` · **Project:** `resumetailored-platform/` (Next.js 14 + Clerk + Supabase)
**Branch:** `claude/employee-hr-platform-phases-a22afj` (restarted from `main` after #534–#538 merged)
**Draft PR:** [#539 — Employee Settings/Profile under (portal) + fix candidate-drawer leak](https://github.com/marvinperson11-debug/resumetailored/pull/539)
**Checks:** `tsc --noEmit` ✅ · `next lint` ✅ · `next build` ✅

No schema change. No new npm deps.

---

## 1. Drawer bug — root cause and fix

### Why the candidate sidebar appeared
There were no `/employee/settings` or `/employee/profile` routes at all. The **Profile** and **Settings** entries in the top-right avatar menu come from a **shared component**, `components/profile-button.tsx`, rendered inside every `DashboardShell` header (candidate, employer, and employee shells all use it). Those entries hard-navigated to:

```
Profile  → /candidate/profile
Settings → /candidate/settings
```

So when a workforce employee opened the menu and clicked Profile/Settings, they were taken to the **candidate routes**, which render the candidate layout and therefore the **candidate sidebar** in the hamburger drawer. Every other `/employee/*` page rendered the employee sidebar correctly — which is exactly the "only Settings + Profile are wrong" symptom reported.

### Fix
- **`ProfileButton` is now pathname-aware** (`usePathname()`): inside `/employee` it routes to `/employee/profile` + `/employee/settings`; everywhere else it keeps the existing `/candidate/*` destinations. The **employer shell is unchanged**. The candidate drawer can no longer appear inside `/employee`.
- **New `/employee/(portal)/profile` and `/employee/(portal)/settings`** pages, both placed in the **`(portal)` route group** so they render the employee shell + sidebar like every other employee route (this is the group established in #536 whose layout provides the employee drawer).

Result: **every** `/employee` route — including Settings and Profile — now renders the employee drawer.

## 2. Employee Settings trim

The employee Settings page (`app/employee/(portal)/settings/`) keeps **only**:
- **Notifications** — Product updates + Tips toggles, persisted via the existing `/api/profile` endpoint (same store the candidate settings use).
- **Account** — change password (via Clerk `user.updatePassword`).

**Removed** (per the request, plus two that follow from "keep only"):
- Plan & billing — staff have no billing relationship with us
- Appearance
- Connected accounts
- Privacy, and the account-deletion "danger zone" — this is the employer's managed staff account

The **candidate Settings** and **employer Settings** (email signature, company profile) pages are **untouched**.

## Employee Profile
A read-only summary of the employee's own `employees` row — name, email, role, start date, status — with a note that role/start date are employer-managed, plus a **"Manage account"** button that opens Clerk's account panel (photo / name / email) without leaving the portal.

## Files
| File | Change |
|---|---|
| `components/profile-button.tsx` | Pathname-aware Profile/Settings routing (employee → `/employee/*`) |
| `app/employee/(portal)/settings/page.tsx` + `settings-client.tsx` | New trimmed employee Settings (Notifications + Account only) |
| `app/employee/(portal)/profile/page.tsx` + `profile-client.tsx` | New employee Profile |

## Verification (honest)
- `tsc` / `lint` / `build` green (after clearing the stale `.next/` cache). `/employee/settings` and `/employee/profile` build as routes under `/employee` (inside the portal group).
- A live click-through of the avatar menu wasn't exercisable in the sandbox, but the routing is deterministic: `ProfileButton` reads `usePathname()`, and both new pages sit inside the `(portal)` group whose layout renders the employee sidebar.

**Suggested smoke test:**
1. In the employee portal, open the avatar menu → **Settings** → lands on `/employee/settings`, employee drawer shows, and only **Notifications** + **Account (change password)** are present.
2. Avatar menu → **Profile** → `/employee/profile`, employee drawer, your details shown.
3. Confirm a candidate account's avatar menu still goes to `/candidate/*`, and the employer Settings page is unchanged.

## PR status
- **#534–#538** — merged to `main`.
- **#539** — draft, awaiting your review/merge.
