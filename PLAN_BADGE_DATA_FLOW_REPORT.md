# Plan badge: "Corporate" vs Settings "Free" — root cause, fix, data flow

## Status of the earlier follow-up
Not resolved before now — and this exact symptom ("Corporate" vs Free) was not what I traced earlier (I looked for candidate "Pro · active" leaking onto employer pages and found no such path). This pass found the real cause.

## Data flow found
All plan data starts at `getAccess()` (`lib/plan.ts`): Clerk `publicMetadata` → `{plan, type, tier}`, or, for the admin, a synthetic `{plan:"pro", type:"individual", isAdmin:true}` with **no `tier`**.
- **Employer sidebar badge** — `app/employer/layout.tsx` computed `planLabel = access.isAdmin ? "Corporate" : tierLabel(normalizeTier(access.tier))` → `EmployerSidebar` footer. For the admin it was hardcoded **Corporate**.
- **Employer Settings "Current plan"** — `app/employer/settings/page.tsx` passed `access.tier` → `settings-client.tsx` `normalizeTier(tier)` → **Free** (admin has no tier).
- **Candidate sidebar badge** — `app/candidate/layout.tsx` passed `access.plan` → `CandidateSidebar` ("Pro · active" / "via {employer}" / "Free plan · Upgrade").
So the only account that is "candidate Pro + employer Free" is the admin bypass, and two employer-side readers used two different rules. (Non-admin accounts hold one `plan`, so a regular user cannot be Pro on one side and an employer on the other.)

## Fix
New pure module `lib/plan-badge.ts` — the single decision point (`sideOfPath`, `planBadgeFor`, `planBadgeForPath`): candidate side → candidate plan; employer side → stored employer tier; neutral → `null` (no badge). Wired into the employer layout badge, employer Settings, and the candidate layout, so badge and Settings cannot disagree by construction.

## Behavior change to be aware of
For the admin account the employer badge now reads **Free** (the stored tier), matching Settings. The admin's *entitlements* are unchanged — every gate still checks `access.isAdmin` and treats the admin as unlimited/Corporate; only the label is no longer inflated. If you'd rather Settings and badge both say "Corporate (admin)", that's a one-line change in `planBadgeFor`.

## Neutral pages
No neutral surface (sign-in, public pages, `/employee` portal) renders a plan badge today; `planBadgeFor("neutral")` returns `null` so any future one cannot borrow a side's plan.

## Test
`npm run test:plan-badge` (`scripts/test-plan-badge.cjs`): candidate Pro + employer Free → **Pro** on `/candidate/*`, **Free** on `/employer/*`, none on neutral paths (for both the admin bypass and a Pro account with a stored free tier); badge == Settings value for every tier string; wiring checks that the layouts use the helper and the `isAdmin ? "Corporate"` shortcut is gone. Passes. Not run: `tsc`/`next build` (platform deps not installed in the sandbox) and no browser check — verify on the live site as the admin: `/employer` footer badge should read Free and `/candidate` Pro.
